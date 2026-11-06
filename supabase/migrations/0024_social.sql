-- 0024: correspondence support + the social layer.
-- Friends, challenges, spectating, arena tournaments, simuls, weekly
-- leagues, clubs, forums, direct messages and study cloud sync.
-- Every new table is RLS-protected; cross-player reads that must bypass
-- the players-only games policy go through SECURITY DEFINER RPCs that
-- return only public fields.

-- ---------------------------------------------------------------
-- correspondence: games.tc becomes nullable (null = no clock)
-- ---------------------------------------------------------------
alter table public.games alter column tc drop not null;

-- ---------------------------------------------------------------
-- studies (cloud sync for the Studies page; local copy is primary)
-- ---------------------------------------------------------------
create table if not exists public.studies (
  id text primary key,
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.studies enable row level security;
create policy studies_owner_all on public.studies for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- ---------------------------------------------------------------
-- friendships: one directed row; status pending -> accepted
-- ---------------------------------------------------------------
create table if not exists public.friendships (
  requester uuid not null references auth.users(id) on delete cascade,
  addressee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
alter table public.friendships enable row level security;
create policy friendships_read on public.friendships for select
  using (requester = auth.uid() or addressee = auth.uid());
create policy friendships_insert on public.friendships for insert
  with check (requester = auth.uid());
create policy friendships_update on public.friendships for update
  using (addressee = auth.uid()) with check (addressee = auth.uid());
create policy friendships_delete on public.friendships for delete
  using (requester = auth.uid() or addressee = auth.uid());

-- ---------------------------------------------------------------
-- challenges: a created invite game addressed to a friend
-- ---------------------------------------------------------------
create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);
alter table public.challenges enable row level security;
create policy challenges_read on public.challenges for select
  using (from_user = auth.uid() or to_user = auth.uid());
create policy challenges_insert on public.challenges for insert
  with check (from_user = auth.uid());
create policy challenges_delete on public.challenges for delete
  using (from_user = auth.uid() or to_user = auth.uid());

-- ---------------------------------------------------------------
-- spectating: public, read-only views of live and finished games
-- ---------------------------------------------------------------
create or replace function public.watch_live_games(p_limit int default 20)
returns table (
  id uuid, white_name text, black_name text, tc_label text,
  rated boolean, moves_count int, fen text, turn text, updated_at timestamptz
)
language sql security definer set search_path = public as $$
  select g.id,
         coalesce(wp.username, 'Guest'),
         coalesce(bp.username, 'Guest'),
         coalesce(g.tc ->> 'label', 'Correspondence'),
         g.rated,
         coalesce(jsonb_array_length(g.moves), 0),
         g.fen,
         g.turn,
         g.updated_at
  from public.games g
  left join public.profiles wp on wp.id = g.white_id
  left join public.profiles bp on bp.id = g.black_id
  where g.status = 'active'
  order by g.updated_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.watch_game(p_game_id uuid)
returns jsonb
language sql security definer set search_path = public as $$
  select to_jsonb(g) - 'invite_code'
  from public.games g
  where g.id = p_game_id and g.status in ('active', 'over');
$$;

grant execute on function public.watch_live_games(int) to anon, authenticated;
grant execute on function public.watch_game(uuid) to anon, authenticated;

-- ---------------------------------------------------------------
-- arena tournaments: anyone creates one; points are scored only
-- through record_tournament_game, which re-validates the finished
-- game server-side (players, window, exact time control, one score
-- per game) so standings cannot be inflated from the client.
-- ---------------------------------------------------------------
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  tc jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table public.tournaments enable row level security;
create policy tournaments_read on public.tournaments for select using (true);
create policy tournaments_insert on public.tournaments for insert
  with check (created_by = auth.uid());

create table if not exists public.tournament_points (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  points numeric not null default 0,
  wins int not null default 0,
  games int not null default 0,
  streak int not null default 0,
  primary key (tournament_id, user_id)
);
alter table public.tournament_points enable row level security;
create policy tournament_points_read on public.tournament_points for select using (true);

create table if not exists public.tournament_scored (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  primary key (tournament_id, game_id)
);
alter table public.tournament_scored enable row level security;

create or replace function public.record_tournament_game(p_tournament uuid, p_game uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments%rowtype;
  g public.games%rowtype;
  me uuid := auth.uid();
  my_color text;
  won boolean;
  drew boolean;
  marked uuid;
begin
  if me is null then raise exception 'sign in required'; end if;
  select * into t from public.tournaments where id = p_tournament;
  if not found then raise exception 'no such tournament'; end if;
  select * into g from public.games where id = p_game;
  if not found or g.status <> 'over' or g.result is null then
    raise exception 'game not finished';
  end if;
  if g.white_id <> me and g.black_id <> me then raise exception 'not your game'; end if;
  if g.created_at < t.starts_at or g.created_at > t.ends_at + interval '6 hours' then
    raise exception 'game outside the arena window';
  end if;
  if g.tc is distinct from t.tc then raise exception 'wrong time control for this arena'; end if;

  insert into public.tournament_scored (tournament_id, game_id)
  values (p_tournament, p_game)
  on conflict do nothing
  returning game_id into marked;
  if marked is null then return; end if; -- already scored

  my_color := case when g.white_id = me then 'w' else 'b' end;
  won := (g.result ->> 'winner') = my_color;
  drew := (g.result ->> 'winner') is null;

  insert into public.tournament_points (tournament_id, user_id, points, wins, games, streak)
  values (
    p_tournament, me,
    case when won then 2 when drew then 1 else 0 end,
    case when won then 1 else 0 end,
    1,
    case when won then 1 else 0 end
  )
  on conflict (tournament_id, user_id) do update set
    points = public.tournament_points.points +
      case when won then 2 + (case when public.tournament_points.streak > 0 then 1 else 0 end)
           when drew then 1 else 0 end,
    wins = public.tournament_points.wins + (case when won then 1 else 0 end),
    games = public.tournament_points.games + 1,
    streak = case when won then public.tournament_points.streak + 1 else 0 end;
end;
$$;
grant execute on function public.record_tournament_game(uuid, uuid) to authenticated;

-- two standing arenas so the page is never empty
insert into public.tournaments (name, starts_at, ends_at, tc)
select 'Blitz Arena', now() - interval '1 hour', now() + interval '5 days',
       '{"type":"blitz","base":300000,"inc":0,"label":"5 + 0"}'::jsonb
where not exists (select 1 from public.tournaments where name = 'Blitz Arena');
insert into public.tournaments (name, starts_at, ends_at, tc)
select 'Rapid Arena', now() - interval '1 hour', now() + interval '5 days',
       '{"type":"rapid","base":600000,"inc":0,"label":"10 + 0"}'::jsonb
where not exists (select 1 from public.tournaments where name = 'Rapid Arena');

-- ---------------------------------------------------------------
-- weekly leagues: standings computed from finished games
-- ---------------------------------------------------------------
create or replace function public.league_standings(p_limit int default 20)
returns table (user_id uuid, username text, wins int, games int)
language sql security definer set search_path = public as $$
  select p.id,
         p.username,
         count(*) filter (
           where (g.white_id = p.id and g.result ->> 'winner' = 'w')
              or (g.black_id = p.id and g.result ->> 'winner' = 'b')
         )::int as wins,
         count(*)::int as games
  from public.games g
  join public.profiles p on p.id in (g.white_id, g.black_id)
  where g.status = 'over'
    and g.result is not null
    and g.created_at > now() - interval '7 days'
  group by p.id, p.username
  order by wins desc, games desc
  limit least(greatest(p_limit, 1), 50);
$$;
grant execute on function public.league_standings(int) to anon, authenticated;

-- ---------------------------------------------------------------
-- simuls: a host opens boards; each board is a normal invite game
-- ---------------------------------------------------------------
create table if not exists public.simuls (
  id uuid primary key default gen_random_uuid(),
  host uuid not null references auth.users(id) on delete cascade,
  title text not null,
  open boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.simuls enable row level security;
create policy simuls_read on public.simuls for select using (true);
create policy simuls_insert on public.simuls for insert with check (host = auth.uid());
create policy simuls_update on public.simuls for update
  using (host = auth.uid()) with check (host = auth.uid());

create table if not exists public.simul_boards (
  simul_id uuid not null references public.simuls(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  primary key (simul_id, game_id)
);
alter table public.simul_boards enable row level security;
create policy simul_boards_read on public.simul_boards for select using (true);
create policy simul_boards_insert on public.simul_boards for insert
  with check (exists (select 1 from public.simuls s where s.id = simul_id and s.host = auth.uid()));

-- ---------------------------------------------------------------
-- clubs
-- ---------------------------------------------------------------
create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  owner uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.clubs enable row level security;
create policy clubs_read on public.clubs for select using (true);
create policy clubs_insert on public.clubs for insert with check (owner = auth.uid());
create policy clubs_update on public.clubs for update
  using (owner = auth.uid()) with check (owner = auth.uid());
create policy clubs_delete on public.clubs for delete using (owner = auth.uid());

create table if not exists public.club_members (
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table public.club_members enable row level security;
create policy club_members_read on public.club_members for select using (true);
create policy club_members_insert on public.club_members for insert
  with check (user_id = auth.uid());
create policy club_members_delete on public.club_members for delete
  using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- forums (announcements live here as the pinned 'news' category)
-- ---------------------------------------------------------------
create table if not exists public.forum_threads (
  id uuid primary key default gen_random_uuid(),
  author uuid not null references auth.users(id) on delete cascade,
  category text not null default 'general',
  title text not null,
  created_at timestamptz not null default now()
);
alter table public.forum_threads enable row level security;
create policy forum_threads_read on public.forum_threads for select using (true);
create policy forum_threads_insert on public.forum_threads for insert
  with check (author = auth.uid());
create policy forum_threads_delete on public.forum_threads for delete
  using (author = auth.uid());

create table if not exists public.forum_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.forum_threads(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.forum_posts enable row level security;
create policy forum_posts_read on public.forum_posts for select using (true);
create policy forum_posts_insert on public.forum_posts for insert
  with check (author = auth.uid());
create policy forum_posts_delete on public.forum_posts for delete
  using (author = auth.uid());

-- ---------------------------------------------------------------
-- direct messages
-- ---------------------------------------------------------------
create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  sender uuid not null references auth.users(id) on delete cascade,
  recipient uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  check (sender <> recipient)
);
create index if not exists dm_messages_pair_idx
  on public.dm_messages (sender, recipient, created_at);
alter table public.dm_messages enable row level security;
create policy dm_read on public.dm_messages for select
  using (sender = auth.uid() or recipient = auth.uid());
create policy dm_insert on public.dm_messages for insert
  with check (sender = auth.uid());

do $$
begin
  alter publication supabase_realtime add table public.dm_messages;
exception when duplicate_object then
  null; -- already in the publication
end $$;
