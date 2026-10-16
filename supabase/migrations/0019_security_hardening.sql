-- 0019: security hardening — per-user rate limits, definer-function audit
-- fixes, the avatars storage bucket, and the function-grant lockdown.
--
-- 1. rate_limits + rate_check(): every hot RPC gets a ceiling the database
--    enforces itself (the client is never trusted). Counters live in
--    (user_id, bucket, window_start) rows; only SECURITY DEFINER code and
--    the service role may write them, owners may read their own. Limits are
--    generous multiples of what the UI actually does:
--      queue_match       60/min   the queue polls every 2.5s while waiting
--      sync_guest        30/min   identity sync runs on session/profile changes
--      touch_guest       60/min   heartbeats, several tabs
--      check_username   120/min   debounced availability checks while typing
--      update_username   10/h     (plus the existing 5/day counter)
--      claim_username    10/h
--      report             5/h     (edge function, via the service role)
--    record_puzzle_result already counts its own per-minute + daily caps
--    (0013) — confirmed, left untouched.
--
-- 2. Definitive-function audit: every SECURITY DEFINER function keeps its
--    pinned search_path and is now re-checked for missing input bounds. Two
--    fixes: check_username refuses absurdly long input before trimming, and
--    finalize_game only lets a PLAYER of the game trigger its rating update
--    (it was callable by any signed-in user with a game id).
--
-- 3. Reports: the client-side insert policy is dropped. The edge function is
--    the only writer now, and it gates on "game exists, caller was a player,
--    reported the opponent" plus the report rate limit.
--
-- 4. Storage: the public-read `avatars` bucket. Objects are written only
--    into avatars/<the writer's uid>/...; reads are open (public bucket);
--    profiles.avatar_path (0018) references these paths.
--
-- 5. Grants: EXECUTE on every public function is revoked from anon and
--    PUBLIC, then re-granted to authenticated exactly for the browser-facing
--    RPCs (extends 0014/0015; asserted by the integration allowlist test).
--
-- Apply with: supabase db push   (or paste into the SQL editor)

begin;

-- ============================================================ rate limits

create table if not exists public.rate_limits (
  user_id uuid not null references auth.users (id) on delete cascade,
  bucket text not null check (char_length(bucket) between 1 and 40),
  window_start timestamptz not null,
  count int not null default 0 check (count >= 0),
  primary key (user_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;

-- owners may inspect their own counters; nobody writes them directly
drop policy if exists "own rate limit rows" on public.rate_limits;
create policy "own rate limit rows" on public.rate_limits
  for select using (auth.uid() = user_id);

revoke all on table public.rate_limits from anon, authenticated;
grant select on table public.rate_limits to authenticated;

-- fixed-window per-user limiter. Server-only: callable from SECURITY DEFINER
-- functions (which run as the owner) and the service role (edge functions).
create or replace function public.rate_check(
  p_user_id uuid,
  p_bucket text,
  p_limit int,
  p_window_secs int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz;
  c int;
begin
  if p_user_id is null or p_bucket is null or p_limit is null or p_limit < 1
     or p_window_secs is null or p_window_secs < 1 then
    return false;
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_secs) * p_window_secs);
  insert into public.rate_limits (user_id, bucket, window_start, count)
  values (p_user_id, left(p_bucket, 40), w, 1)
  on conflict (user_id, bucket, window_start)
    do update set count = public.rate_limits.count + 1
  returning count into c;
  -- opportunistic prune keeps the table tiny without a scheduler
  if c = 1 and random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return c <= p_limit;
end;
$$;

revoke all on function public.rate_check(uuid, text, int, int) from public, anon, authenticated;
grant execute on function public.rate_check(uuid, text, int, int) to service_role;

-- ============================================================ RPC: sync guest identity

-- Identity sync is fire-and-forget from the client: when the per-minute
-- ceiling is hit the call is skipped silently (the next window syncs).
create or replace function public.sync_guest(p_username text, p_avatar_seed text, p_flag text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_profile record;
begin
  if auth.uid() is null then
    return;
  end if;
  if not public.rate_check(auth.uid(), 'sync_guest', 30, 60) then
    return;
  end if;

  select username, avatar_seed, flag into p_profile
    from public.profiles
   where id = auth.uid();

  insert into public.guests (id, username, avatar_seed, flag)
  values (auth.uid(),
          coalesce(p_profile.username, left(trim(p_username), 20)),
          coalesce(p_profile.avatar_seed, left(p_avatar_seed, 64)),
          case
            when p_profile.username is not null then p_profile.flag
            when p_flag is null or p_flag = '' then null
            else left(p_flag, 8)
          end)
  on conflict (id) do update
    set username = coalesce(p_profile.username, excluded.username),
        avatar_seed = coalesce(p_profile.avatar_seed, excluded.avatar_seed),
        flag = case
                 when p_profile.username is not null then p_profile.flag
                 else excluded.flag
               end,
        last_seen = now();
end;
$$;

-- ============================================================ RPC: heartbeat

-- Heartbeats are ignored (not errors) past the ceiling — a stuck tab must
-- not be able to spam last_seen writes.
create or replace function public.touch_guest()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  if not public.rate_check(auth.uid(), 'touch_guest', 60, 60) then
    return;
  end if;
  update public.guests set last_seen = now() where id = auth.uid();
end;
$$;

-- ============================================================ RPC: username rules

create or replace function public.check_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  bare text;
begin
  -- bound the input before any work happens on it
  if char_length(coalesce(p_username, '')) > 200 then
    return 'Username must be 3-20 characters';
  end if;
  if auth.uid() is not null and not public.rate_check(auth.uid(), 'check_username', 120, 60) then
    return 'Too many checks — pause a moment';
  end if;

  t := trim(coalesce(p_username, ''));
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
  if not public.rate_check(me, 'claim_username', 10, 3600) then
    return jsonb_build_object('ok', false, 'error', 'Too many attempts — try again soon');
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
  if not public.rate_check(me, 'update_username', 10, 3600) then
    return jsonb_build_object('ok', false, 'error', 'Too many changes — try again soon');
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

-- ============================================================ RPC: queue_match (rate limited)

create or replace function public.queue_match(p_tc jsonb, p_rated boolean, p_rating int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e record;
  new_game uuid;
  my_color text;
  my_id uuid := auth.uid();
  base int;
  inc int;
  cat text;
  my_rating int;
  prev_first timestamptz;
  cr text;
  max_window int;
begin
  if my_id is null then
    raise exception 'not authenticated';
  end if;
  if not public.rate_check(my_id, 'queue_match', 60, 60) then
    raise exception 'Too many matchmaking requests — slow down a moment';
  end if;

  base := (p_tc->>'base')::bigint;
  inc := (p_tc->>'inc')::bigint;
  if base is null or base < 10000 or base > 10800000
     or inc is null or inc < 0 or inc > 60000
     or p_tc->>'type' is null
     or char_length(p_tc->>'type') > 20 then
    raise exception 'invalid time control';
  end if;

  cat := public.tc_category(p_tc);

  -- the ratings table is authoritative; p_rating only seeds brand-new players
  select r.rating into my_rating from public.ratings r
   where r.user_id = my_id and r.category = cat;
  if not found then
    my_rating := coalesce(p_rating, 200);
  end if;
  my_rating := least(3000, greatest(100, my_rating));

  -- already matched? (a recent active game with me in it)
  select id, white_id into e from public.games
   where status = 'active'
     and (white_id = my_id or black_id = my_id)
     and created_at > now() - interval '5 minutes'
   order by created_at desc
   limit 1;
  if found then
    delete from public.lobby where guest_id = my_id;
    my_color := case when e.white_id = my_id then 'w' else 'b' end;
    return jsonb_build_object('status', 'matched', 'game_id', e.id, 'color', my_color);
  end if;

  delete from public.lobby where guest_id = my_id and created_at < now() - interval '15 minutes';

  max_window := coalesce(nullif(current_setting('app.queue_window_max', true), '')::int, 600);

  select * into e from public.lobby l
   where l.guest_id <> my_id
     -- tie-break: only the smaller guest id creates the game
     and l.guest_id > my_id
     and l.rated = p_rated
     and l.created_at > now() - interval '10 minutes'
     -- same category (time-control formula), then the widening window
     and public.tc_category(l.tc) = cat
     and abs(l.rating - my_rating) <= least(
           max_window,
           100 + floor(extract(epoch from (now() - coalesce(l.first_seen, l.created_at))) / 5) * 50)
   order by l.created_at
   for update skip locked
   limit 1;

  if found then
    delete from public.lobby where id = e.id;
    if random() < 0.5 then
      my_color := 'w';
    else
      my_color := 'b';
    end if;
    insert into public.games (white_id, black_id, tc, rated, wms, bms, status)
    values (
      case when my_color = 'w' then my_id else e.guest_id end,
      case when my_color = 'w' then e.guest_id else my_id end,
      p_tc, p_rated, base, base, 'active'
    ) returning id, casual_reason into new_game, cr;
    if cr = 'farming_limit' then
      return jsonb_build_object(
        'status', 'matched', 'game_id', new_game, 'color', my_color,
        'notice', 'You have already played 4 rated games against this opponent in 24 hours — this game is casual.');
    end if;
    return jsonb_build_object('status', 'matched', 'game_id', new_game, 'color', my_color);
  end if;

  -- enqueue, preserving the original search start so the window really widens
  select first_seen into prev_first from public.lobby
   where guest_id = my_id order by created_at desc limit 1;
  delete from public.lobby where guest_id = my_id;
  insert into public.lobby (guest_id, tc, rated, rating, first_seen)
  values (my_id, p_tc, p_rated, my_rating, coalesce(prev_first, now()))
  returning id into e;
  return jsonb_build_object(
    'status', 'waiting',
    'entry_id', e.id,
    'window', least(max_window,
      100 + floor(extract(epoch from (now() - coalesce(prev_first, now()))) / 5) * 50));
end;
$$;

-- ============================================================ RPC: finalize a rated game (players only)

create or replace function public.finalize_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  cat text;
  n int;
  start_turn text;
  w_moves int;
  b_moves int;
  white_score numeric;
  w_before record;
  b_before record;
  w_new record;
  b_new record;
  elapsed_w bigint;
  elapsed_b bigint;
  now_ts timestamptz := now();
  existing int;
  lock_order uuid[];
  rec record;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  -- serialize concurrent finalizers of the same game on the row lock
  select * into g from public.games where id = p_game_id for update;
  if not found then
    return jsonb_build_object('changed', false, 'reason', 'not_found');
  end if;

  -- only a player of this game may trigger its rating update
  if g.white_id is distinct from auth.uid() and g.black_id is distinct from auth.uid() then
    return jsonb_build_object('changed', false, 'reason', 'not_a_player');
  end if;

  if g.status = 'aborted' then
    return jsonb_build_object('changed', false, 'reason', 'aborted');
  end if;
  if g.status <> 'over' or g.result is null then
    return jsonb_build_object('changed', false, 'reason', 'not_finished');
  end if;
  if not g.rated then
    return jsonb_build_object('changed', false, 'reason', 'casual');
  end if;
  if g.white_id is null or g.black_id is null then
    return jsonb_build_object('changed', false, 'reason', 'incomplete');
  end if;

  -- anti-abuse: at least 2 moves by each player, else no rating change
  n := coalesce(jsonb_array_length(g.moves), 0);
  start_turn := split_part(g.start_fen, ' ', 2);
  if start_turn = 'w' then
    w_moves := (n + 1) / 2;
    b_moves := n / 2;
  else
    w_moves := n / 2;
    b_moves := (n + 1) / 2;
  end if;
  if w_moves < 2 or b_moves < 2 then
    return jsonb_build_object('changed', false, 'reason', 'too_few_moves');
  end if;

  -- idempotency gate: one history row per (game, player), ever
  select count(*) into existing from public.rating_history where game_id = p_game_id;
  if existing > 0 then
    return jsonb_build_object('changed', false, 'reason', 'already_finalized');
  end if;

  cat := public.tc_category(g.tc);

  -- ensure rating rows exist (locked below in deterministic order)
  insert into public.ratings (user_id, category)
  values (g.white_id, cat), (g.black_id, cat)
  on conflict (user_id, category) do nothing;

  -- lock both rows in ascending user_id order (no deadlocks across games)
  lock_order := array[g.white_id, g.black_id];
  if lock_order[1] > lock_order[2] then
    lock_order := array[lock_order[2], lock_order[1]];
  end if;
  for rec in
    select r.user_id, r.rating, r.rd, r.vol, r.updated_at
      from public.ratings r
     where r.user_id = any (lock_order) and r.category = cat
     order by r.user_id
       for update
  loop
    if rec.user_id = g.white_id then w_before := rec; else b_before := rec; end if;
  end loop;
  if w_before is null or b_before is null then
    raise exception 'rating rows missing';
  end if;

  white_score := case when g.result ->> 'winner' = 'w' then 1
                      when g.result ->> 'winner' = 'b' then 0
                      else 0.5 end;
  elapsed_w := greatest(0, (extract(epoch from (now_ts - w_before.updated_at)) * 1000)::bigint);
  elapsed_b := greatest(0, (extract(epoch from (now_ts - b_before.updated_at)) * 1000)::bigint);

  select * into w_new from public.glicko200_update(
    w_before.rating, w_before.rd, w_before.vol, w_before.updated_at,
    b_before.rating, b_before.rd, white_score, elapsed_w, now_ts);
  select * into b_new from public.glicko200_update(
    b_before.rating, b_before.rd, b_before.vol, b_before.updated_at,
    w_before.rating, w_before.rd, 1 - white_score, elapsed_b, now_ts);

  update public.ratings
     set rating = w_new.rating, rd = w_new.rd, vol = w_new.vol,
         games = games + 1,
         wins = wins + case when white_score = 1 then 1 else 0 end,
         draws = draws + case when white_score = 0.5 then 1 else 0 end,
         losses = losses + case when white_score = 0 then 1 else 0 end,
         peak = greatest(peak, w_new.rating),
         updated_at = now_ts
   where user_id = g.white_id and category = cat;

  update public.ratings
     set rating = b_new.rating, rd = b_new.rd, vol = b_new.vol,
         games = games + 1,
         wins = wins + case when white_score = 0 then 1 else 0 end,
         draws = draws + case when white_score = 0.5 then 1 else 0 end,
         losses = losses + case when white_score = 1 then 1 else 0 end,
         peak = greatest(peak, b_new.rating),
         updated_at = now_ts
   where user_id = g.black_id and category = cat;

  insert into public.rating_history
    (user_id, category, game_id, rating_before, rating_after, rd_after, opponent_id, result)
  values
    (g.white_id, cat, g.id, w_before.rating, w_new.rating, w_new.rd, g.black_id,
     case when white_score = 1 then 'win' when white_score = 0 then 'loss' else 'draw' end),
    (g.black_id, cat, g.id, b_before.rating, b_new.rating, b_new.rd, g.white_id,
     case when white_score = 1 then 'loss' when white_score = 0 then 'win' else 'draw' end)
  on conflict (game_id, user_id) do nothing;

  return jsonb_build_object(
    'changed', true,
    'category', cat,
    'white', jsonb_build_object(
      'user_id', g.white_id, 'before', w_before.rating, 'after', w_new.rating,
      'rd', w_new.rd, 'provisional', w_new.rd > 110),
    'black', jsonb_build_object(
      'user_id', g.black_id, 'before', b_before.rating, 'after', b_new.rating,
      'rd', b_new.rd, 'provisional', b_new.rd > 110)
  );
end;
$$;

-- ============================================================ reports: one gated writer

-- The client inserted directly through this policy. Reports now come only
-- from the report edge function (service role), which checks that the game
-- exists, that the caller played it, and that the target is the opponent.
drop policy if exists "submit report" on public.reports;

-- ============================================================ storage: avatars bucket

-- public-read, but writes are confined to avatars/<the writer's uid>/...
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars are public" on storage.objects;
create policy "avatars are public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatar owners insert into their folder" on storage.objects;
create policy "avatar owners insert into their folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "avatar owners update their files" on storage.objects;
create policy "avatar owners update their files" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

drop policy if exists "avatar owners delete their files" on storage.objects;
create policy "avatar owners delete their files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (auth.uid())::text);

-- ============================================================ function grants lockdown

-- Nothing in public is executable by anon or PUBLIC (all functions, present
-- and future-proofed for the ones restated above); authenticated keeps
-- exactly the browser-facing RPCs (0014/0015 + the handlers above updated
-- the rest of the list in place).
revoke execute on all functions in schema public from anon, public;

grant execute on function public.cancel_queue() to authenticated;
grant execute on function public.check_username(text) to authenticated;
grant execute on function public.claim_username(text, text, text) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.finalize_game(uuid) to authenticated;
grant execute on function public.leaderboard(text, integer, integer) to authenticated;
grant execute on function public.puzzle_leaderboard(integer, integer) to authenticated;
grant execute on function public.queue_match(jsonb, boolean, integer) to authenticated;
grant execute on function public.record_puzzle_result(text, boolean, bigint, bigint) to authenticated;
grant execute on function public.sync_guest(text, text, text) to authenticated;
grant execute on function public.touch_guest() to authenticated;
grant execute on function public.update_username(text) to authenticated;

commit;
