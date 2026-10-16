-- 0007: accounts, per-category ratings (200 scale), rating history.
--
-- Ratings live in their own table on the 200 scale (start 200, floor 100,
-- rd 45..350, vol 0.01..0.5 — all enforced by CHECKs). Nobody but server-
-- side code (SECURITY DEFINER RPCs) may write them: table-level DML is
-- revoked from anon/authenticated, so the browser cannot touch a rating,
-- a history row, or a game result.
--
-- profiles holds registered accounts only (guests have no profile): the
-- existence of a profile row is what makes a player leaderboard-eligible
-- after they upgrade a guest session.
--
-- Apply with: supabase db push   (or paste into the SQL editor)

begin;

-- ============================================================ profiles

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 3 and 20),
  -- canonical lowercase form; the UNIQUE index below enforces
  -- case-insensitive uniqueness at the database level
  username_key text generated always as (lower(username)) stored unique,
  avatar_seed text not null default '',
  flag text check (flag is null or char_length(flag) between 2 and 8),
  -- username change rate limiting (max 5 per calendar day)
  username_changes int not null default 0,
  username_change_day date,
  created_at timestamptz not null default now()
);

create index if not exists profiles_username_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

drop policy if exists "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select using (true);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- clients may only touch avatar/flag directly; username goes exclusively
-- through the claim_username / update_username RPCs (rules + rate limits)
revoke insert, update, delete on table public.profiles from anon, authenticated;
grant update (avatar_seed, flag) on table public.profiles to authenticated;

-- ============================================================ ratings

create table if not exists public.ratings (
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('bullet', 'blitz', 'rapid', 'classical', 'puzzle')),
  rating int not null default 200 check (rating >= 100 and rating <= 3000),
  rd int not null default 350 check (rd >= 45 and rd <= 350),
  vol numeric(6, 4) not null default 0.06 check (vol >= 0.01 and vol <= 0.5),
  games int not null default 0 check (games >= 0),
  wins int not null default 0,
  draws int not null default 0,
  losses int not null default 0,
  peak int not null default 200 check (peak >= 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, category)
);

-- leaderboard + profile queries
create index if not exists ratings_board_idx on public.ratings (category, rating desc, rd);
create index if not exists ratings_user_idx on public.ratings (user_id);

alter table public.ratings enable row level security;
revoke insert, update, delete on table public.ratings from anon, authenticated;
-- (read stays open: world-readable profile/leaderboard data)

-- ============================================================ rating history

create table if not exists public.rating_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('bullet', 'blitz', 'rapid', 'classical', 'puzzle')),
  game_id uuid not null references public.games (id) on delete cascade,
  rating_before int not null,
  rating_after int not null check (rating_after >= 100),
  rd_after int not null check (rd_after >= 45 and rd_after <= 350),
  opponent_id uuid references auth.users (id) on delete set null,
  result text not null check (result in ('win', 'draw', 'loss')),
  created_at timestamptz not null default now(),
  -- one row per player per game: finalization is idempotent by construction
  constraint rating_history_once unique (game_id, user_id)
);

create index if not exists rating_history_user_idx
  on public.rating_history (user_id, category, created_at desc);
create index if not exists rating_history_opp_idx
  on public.rating_history (user_id, opponent_id, created_at desc);

alter table public.rating_history enable row level security;
revoke insert, update, delete on table public.rating_history from anon, authenticated;
-- (read stays open: profile rating charts + public results)

-- ============================================================ RPC: username rules

-- Mirror of src/lib/usernames.ts — the database stays authoritative.
create or replace function public.check_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t text := trim(coalesce(p_username, ''));
  bare text;
begin
  if char_length(t) < 3 or char_length(t) > 20 then
    return 'Username must be 3-20 characters';
  end if;
  if t !~ '^[A-Za-z0-9_-]{3,20}$' then
    return 'Use letters, numbers, underscores or hyphens only';
  end if;
  if lower(t) in (
    'admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'help', 'root',
    'system', 'official', 'team', 'freechess', 'chess', 'god', 'superuser', 'chat',
    'api', 'security', 'sales', 'service', 'billing', 'owner', 'creator', 'founder',
    'ceo', 'cto', 'employee', 'bot', 'null', 'undefined', 'anonymous', 'everyone',
    'all', 'me', 'you', 'player', 'guest', 'anonymoususer', 'nobody', 'website',
    'webmaster', 'postmaster', 'abuse', 'info', 'contact', 'feedback', 'news',
    'operator', 'supervisor', 'chief', 'editor', 'watchman', 'guard', 'modteam'
  ) then
    return 'That username is reserved — pick another one';
  end if;
  bare := regexp_replace(lower(t), '[_-]', '', 'g');
  if bare in ('admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'root',
              'official', 'superuser', 'webmaster', 'freechess', 'modteam', 'anonymous', 'system') then
    return 'That username is reserved — pick another one';
  end if;
  if bare like 'admin%' or bare like '%admin%'
     or bare like 'moderator%' or bare like '%moderator%'
     or bare like 'modteam%' or bare like '%modteam%'
     or bare like 'support%' or bare like 'staff%'
     or bare like 'root%' or bare like 'official%'
     or bare like 'superuser%' or bare like 'webmaster%'
     or bare like 'freechess%' or bare like 'system%' then
    return 'That username is reserved — pick another one';
  end if;
  if exists (select 1 from public.profiles p where p.username_key = lower(t)) then
    return 'That username is already taken';
  end if;
  return null;
end;
$$;

-- ============================================================ RPC: claim username (first sign-up / onboarding)

create or replace function public.claim_username(p_username text, p_avatar_seed text default '', p_flag text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  t text := trim(coalesce(p_username, ''));
  err text;
  is_anon boolean;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  select u.is_anonymous into is_anon from auth.users u where u.id = me;
  if coalesce(is_anon, true) then
    raise exception 'accounts only — sign up first';
  end if;

  -- already claimed: idempotent re-call refreshes avatar/flag only
  if exists (select 1 from public.profiles where id = me) then
    if exists (select 1 from public.profiles where id = me and username_key = lower(t)) then
      update public.profiles
         set avatar_seed = left(coalesce(p_avatar_seed, avatar_seed), 64),
             flag = case when p_flag is null or p_flag = '' then null else left(p_flag, 8) end
       where id = me;
      return jsonb_build_object('ok', true, 'username', t);
    end if;
    return jsonb_build_object('ok', false, 'error', 'You already picked a username — change it in settings');
  end if;

  err := public.check_username(t);
  if err is not null then
    return jsonb_build_object('ok', false, 'error', err);
  end if;

  insert into public.profiles (id, username, avatar_seed, flag)
  values (me, t, left(coalesce(p_avatar_seed, ''), 64),
          case when p_flag is null or p_flag = '' then null else left(p_flag, 8) end);
  -- keep the in-game display name in step with the account name
  update public.guests set username = t where id = me;
  return jsonb_build_object('ok', true, 'username', t);
end;
$$;

-- ============================================================ RPC: change username (rate limited)

create or replace function public.update_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  t text := trim(coalesce(p_username, ''));
  err text;
  is_anon boolean;
  used_today int;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  select u.is_anonymous into is_anon from auth.users u where u.id = me;
  if coalesce(is_anon, true) then
    raise exception 'accounts only — sign up first';
  end if;
  if not exists (select 1 from public.profiles where id = me) then
    return jsonb_build_object('ok', false, 'error', 'Pick a username first');
  end if;

  -- rate limit: at most 5 changes per calendar day
  select coalesce(username_changes, 0) into used_today
    from public.profiles
   where id = me and username_change_day = current_date;
  if coalesce(used_today, 0) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'Username changes are limited to 5 per day — try again tomorrow');
  end if;

  err := public.check_username(t);
  if err is not null then
    -- "taken" by yourself is not an error
    if err = 'That username is already taken' then
      if exists (select 1 from public.profiles where id = me and username_key = lower(t)) then
        return jsonb_build_object('ok', true, 'username', t);
      end if;
    end if;
    return jsonb_build_object('ok', false, 'error', err);
  end if;

  update public.profiles
     set username = t,
         username_changes = case when username_change_day = current_date then username_changes + 1 else 1 end,
         username_change_day = current_date
   where id = me;
  update public.guests set username = t where id = me;
  return jsonb_build_object('ok', true, 'username', t);
end;
$$;

-- ============================================================ RPC: leaderboard

-- Top players per category: registered accounts only (no guests), never
-- provisional (rd > 110), paginated.
create or replace function public.leaderboard(
  p_category text default 'blitz',
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  user_id uuid,
  username text,
  avatar_seed text,
  flag text,
  rating int,
  rd int,
  peak int,
  games int,
  wins int,
  draws int,
  losses int,
  is_provisional boolean,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.user_id, p.username, p.avatar_seed, p.flag, r.rating, r.rd, r.peak,
         r.games, r.wins, r.draws, r.losses, (r.rd > 110), r.updated_at
    from public.ratings r
    join public.profiles p on p.id = r.user_id
   where r.category = case when p_category in ('bullet', 'blitz', 'rapid', 'classical', 'puzzle')
                           then p_category else 'blitz' end
     and r.rd <= 110
   order by r.rating desc, r.games desc, p.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

-- ============================================================ RPC: delete my account

create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  active_count int;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;

  select count(*) into active_count
    from public.games
   where status = 'active' and (white_id = me or black_id = me);
  if active_count > 0 then
    raise exception 'Finish or resign your active games first';
  end if;

  -- waiting invites I own die with the account
  delete from public.games where status = 'waiting' and (white_id = me or black_id = me);

  -- finished games stay, anonymized: my seat is emptied (opponent intact)
  update public.games set white_id = null where white_id = me;
  update public.games set black_id = null where black_id = me;

  delete from public.rating_history where user_id = me;
  delete from public.ratings where user_id = me;
  delete from public.profiles where id = me;
  delete from public.reports where reporter_id = me or reported_id = me;
  delete from public.lobby where guest_id = me;
  delete from public.guests where id = me;
  delete from auth.users where id = me;

  return jsonb_build_object('ok', true);
end;
$$;

commit;
