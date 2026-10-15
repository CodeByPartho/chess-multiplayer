-- FreeChess online platform — initial schema
-- All game mutations happen in Edge Functions (service role); clients only
-- read rows and call SECURITY DEFINER RPCs for queueing + heartbeats.

-- ============================================================ guests

create table if not exists public.guests (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null check (char_length(username) between 3 and 20),
  avatar_seed text not null default '',
  flag text check (flag is null or char_length(flag) between 2 and 8),
  ratings jsonb not null default '{
    "bullet":   {"rating": 1500, "rd": 350, "vol": 0.06, "updatedAt": 0},
    "blitz":    {"rating": 1500, "rd": 350, "vol": 0.06, "updatedAt": 0},
    "rapid":    {"rating": 1500, "rd": 350, "vol": 0.06, "updatedAt": 0},
    "classical":{"rating": 1500, "rd": 350, "vol": 0.06, "updatedAt": 0},
    "puzzle":   {"rating": 1500, "rd": 350, "vol": 0.06, "updatedAt": 0}
  }'::jsonb,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.guests enable row level security;

create policy "guests are public" on public.guests for select using (true);
create policy "insert own guest" on public.guests for insert with check (auth.uid() = id);
create policy "update own guest" on public.guests
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ============================================================ games

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'over', 'aborted')),
  -- nullable while an invite-link game waits for its second player
  white_id uuid references public.guests (id),
  black_id uuid references public.guests (id),
  tc jsonb not null,
  rated boolean not null default false,
  start_fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves jsonb not null default '[]'::jsonb,
  fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  turn text not null default 'w' check (turn in ('w', 'b')),
  halfmove int not null default 0,
  wms bigint not null,
  bms bigint not null,
  last_move_at timestamptz not null default now(),
  draw_offer text check (draw_offer is null or draw_offer in ('w', 'b')),
  takeback_offer text check (takeback_offer is null or takeback_offer in ('w', 'b')),
  result jsonb,
  rematch jsonb not null default '{"w": false, "b": false, "game_id": null}'::jsonb,
  invite_code text unique,
  rematch_of uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint not_self_check check (white_id is null or black_id is null or white_id <> black_id),
  constraint game_needs_player check (white_id is not null or black_id is not null),
  constraint waiting_needs_code check (status <> 'waiting' or invite_code is not null or rematch_of is not null)
);

create index if not exists games_status_created_idx on public.games (status, created_at desc);
create index if not exists games_white_idx on public.games (white_id, created_at desc);
create index if not exists games_black_idx on public.games (black_id, created_at desc);

alter table public.games enable row level security;

-- game state is not sensitive (usernames are public); clients read directly,
-- every write happens through service-role Edge Functions
create policy "games are readable" on public.games for select using (true);

-- realtime for live games
alter publication supabase_realtime add table public.games;

-- ============================================================ matchmaking lobby

create table if not exists public.lobby (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.guests (id) on delete cascade,
  tc jsonb not null,
  rated boolean not null,
  rating int not null,
  created_at timestamptz not null default now()
);

create index if not exists lobby_waiting_idx on public.lobby (created_at);

alter table public.lobby enable row level security;

create policy "own lobby rows" on public.lobby for select using (auth.uid() = guest_id);
create policy "enqueue self" on public.lobby for insert with check (auth.uid() = guest_id);
create policy "leave queue" on public.lobby for delete using (auth.uid() = guest_id);

-- ============================================================ reports

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  reported_id uuid not null,
  game_id uuid,
  reason text not null check (char_length(reason) between 3 and 300),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

create policy "submit report" on public.reports
  for insert with check (auth.uid() = reporter_id and reported_id <> auth.uid());

-- ============================================================ RPC: heartbeat

create or replace function public.touch_guest()
returns void
language sql
security definer
set search_path = public
as $$
  update public.guests set last_seen = now() where id = auth.uid();
$$;

-- ============================================================ RPC: queue

-- Atomically try to find a waiting opponent; otherwise enqueue the caller.
-- Returns {status: 'waiting'|'matched', entry_id?, game_id?, color?}
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
begin
  if my_id is null then
    raise exception 'not authenticated';
  end if;

  -- validate time control (ms): base 10s..180min, inc 0..60s
  base := (p_tc->>'base')::bigint;
  inc := (p_tc->>'inc')::bigint;
  if base is null or base < 10000 or base > 10800000
     or inc is null or inc < 0 or inc > 60000
     or p_tc->>'type' is null then
    raise exception 'invalid time control';
  end if;

  -- purge my stale entries first (prevents duplicate queueing)
  delete from public.lobby where guest_id = my_id and created_at < now() - interval '15 minutes';

  select * into e from public.lobby l
   where l.guest_id <> my_id
     and l.rated = p_rated
     and l.created_at > now() - interval '10 minutes'
     and (
       -- standard types match within the same family; custom must match exactly
       (p_tc->>'type' <> 'custom' and l.tc->>'type' = p_tc->>'type')
       or (p_tc->>'type' = 'custom' and l.tc = p_tc)
     )
     and abs(l.rating - p_rating) <= 200 + floor(extract(epoch from (now() - l.created_at))) * 60
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
      p_tc, p_rated, base, inc, 'active'
    ) returning id into new_game;
    return jsonb_build_object('status', 'matched', 'game_id', new_game, 'color', my_color);
  end if;

  -- enqueue (replace any existing entry for freshness)
  delete from public.lobby where guest_id = my_id;
  insert into public.lobby (guest_id, tc, rated, rating)
  values (my_id, p_tc, p_rated, greatest(800, least(2800, p_rating)))
  returning id into e;
  return jsonb_build_object('status', 'waiting', 'entry_id', e.id);
end;
$$;

-- ============================================================ RPC: cancel queue

create or replace function public.cancel_queue()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.lobby where guest_id = auth.uid();
$$;

-- ============================================================ RPC: upsert guest profile

create or replace function public.sync_guest(p_username text, p_avatar_seed text, p_flag text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.guests (id, username, avatar_seed, flag)
  values (auth.uid(), left(trim(p_username), 20), left(p_avatar_seed, 64),
          case when p_flag is null or p_flag = '' then null else left(p_flag, 8) end)
  on conflict (id) do update
    set username = excluded.username,
        avatar_seed = excluded.avatar_seed,
        flag = excluded.flag,
        last_seen = now();
end;
$$;
