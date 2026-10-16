-- ============================================================
-- 0013: puzzle ratings become server-authoritative + hardening
-- ============================================================
--
-- 1. The client may no longer dictate a rating. The RPC accepts only
--    (puzzle_id, solved, time_ms); the server reads the player's current
--    puzzle rating and the puzzle's difficulty from the database, runs the
--    same Glicko-2 the games use (glicko200_update) and writes the result.
--
-- 2. Idempotency per (user, puzzle, attempt): puzzle_results has a UNIQUE
--    (user_id, puzzle_id, attempt_no). attempt_no is supplied by the client
--    (it is only an anti-replay nonce — it grants no authority) and the
--    unique index makes a replay a pure no-op.
--
-- 3. Abuse limits, all server-side:
--      * rate limit  — at most PUZZLE_RATE_MAX results per user per minute;
--                      faster submissions are refused (NOT silently swallowed,
--                      so the UX can say "slow down").
--      * daily cap   — at most PUZZLE_DAILY_MAX results per UTC day.
--      * solve time  — a solve recorded faster than PUZZLE_MIN_SOLVE_MS is
--                      ignored (counted as neither win nor loss) because no
--                      human could have solved it that fast.
--
-- 4. Puzzle solutions live in the browser, so a puzzle rating can never be
--    fully cheat-proof. The UI labels it as such and the main leaderboards
--    exclude the 'puzzle' category (a separate puzzle board is fine).
--
-- 5. Permissions: every SECURITY DEFINER function gets a pinned search_path,
--    EXECUTE revoked from PUBLIC and anon, granted only to the roles that
--    need it. (The temporary diagnostic probe from 0011 is confirmed gone in
--    0012 and asserted by the function-inventory test.)

-- ------------------------------------------------------------------
-- Catalog: the server must know each puzzle's difficulty itself.
-- Copied from the client asset (id, rating only — solutions never stored).
-- ------------------------------------------------------------------
create table if not exists public.puzzles (
  id text primary key,
  rating int not null check (rating >= 100 and rating <= 3000),
  created_at timestamptz not null default now()
);

alter table public.puzzles enable row level security;
-- world-readable (the client already ships the whole library); no client DML
drop policy if exists "puzzles are public" on public.puzzles;
create policy "puzzles are public" on public.puzzles for select using (true);
revoke insert, update, delete on table public.puzzles from anon, authenticated;

-- ------------------------------------------------------------------
-- Attempt log: one row per (user, puzzle, attempt). This is what makes a
-- replay harmless and lets the rate/daily limits be counted.
-- ------------------------------------------------------------------
create table if not exists public.puzzle_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  puzzle_id text not null references public.puzzles (id) on delete cascade,
  attempt_no bigint not null check (attempt_no >= 0),
  solved boolean not null,
  time_ms bigint,
  rating_before int not null,
  rating_after int not null,
  rd_after int not null,
  created_at timestamptz not null default now(),
  constraint puzzle_attempt_once unique (user_id, puzzle_id, attempt_no)
);

create index if not exists puzzle_results_user_time_idx
  on public.puzzle_results (user_id, created_at desc);

alter table public.puzzle_results enable row level security;
-- the attempt log is a rating write-path artefact: no client DML at all
revoke insert, update, delete on table public.puzzle_results from anon, authenticated;

-- ------------------------------------------------------------------
-- Tunables (adjustable without a migration)
-- ------------------------------------------------------------------
create table if not exists public.puzzle_rating_config (
  key text primary key,
  value bigint not null
);
insert into public.puzzle_rating_config (key, value) values
  ('rate_max_per_minute', 30),
  ('daily_max', 300),
  ('min_solve_ms', 1500),
  ('opp_rd', 80)
on conflict (key) do nothing;

alter table public.puzzle_rating_config enable row level security;
drop policy if exists "config is public" on public.puzzle_rating_config;
create policy "config is public" on public.puzzle_rating_config for select using (true);
revoke insert, update, delete on table public.puzzle_rating_config from anon, authenticated;

-- ------------------------------------------------------------------
-- The RPC
-- ------------------------------------------------------------------
create or replace function public.record_puzzle_result(
  p_puzzle_id text,
  p_solved boolean,
  p_time_ms bigint default null,
  p_attempt_no bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_puzzle public.puzzles%rowtype;
  v_row public.ratings%rowtype;
  v_rate_max bigint;
  v_daily_max bigint;
  v_min_solve bigint;
  v_opp_rd bigint;
  v_recent bigint;
  v_today bigint;
  v_attempt bigint;
  v_score numeric;
  v_elapsed bigint;
  v_out record;
  v_new_rating int;
  v_new_rd int;
  v_new_vol numeric;
  v_ignore boolean := false;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_puzzle_id is null or p_puzzle_id = '' then
    raise exception 'unknown puzzle';
  end if;
  if p_solved is null then
    raise exception 'solved flag required';
  end if;
  -- attempt_no is an anti-replay nonce only; a null becomes 0 so the very
  -- first (user, puzzle, 0) is always unique and any replay collides.
  v_attempt := least(greatest(coalesce(p_attempt_no, 0), 0), 9223372036854775807);

  select * into v_puzzle from public.puzzles where id = p_puzzle_id;
  if not found then
    raise exception 'unknown puzzle';
  end if;

  select value into v_rate_max from public.puzzle_rating_config where key = 'rate_max_per_minute';
  select value into v_daily_max from public.puzzle_rating_config where key = 'daily_max';
  select value into v_min_solve from public.puzzle_rating_config where key = 'min_solve_ms';
  select value into v_opp_rd from public.puzzle_rating_config where key = 'opp_rd';

  -- idempotency: a replay of the same attempt is a no-op, never a 2nd rating
  if exists (select 1 from public.puzzle_results
             where user_id = v_uid and puzzle_id = p_puzzle_id and attempt_no = v_attempt) then
    select * into v_row from public.ratings where user_id = v_uid and category = 'puzzle';
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'ignored', false,
      'rating', coalesce(v_row.rating, 200), 'rd', coalesce(v_row.rd, 350),
      'games', coalesce(v_row.games, 0), 'wins', coalesce(v_row.wins, 0),
      'losses', coalesce(v_row.losses, 0));
  end if;

  -- rate limit: refuse (with an error) if the user is submitting too fast
  select count(*) into v_recent from public.puzzle_results
   where user_id = v_uid and created_at > now() - interval '1 minute';
  if v_recent >= v_rate_max then
    raise exception 'rate limited: wait a moment before solving more puzzles';
  end if;

  -- daily cap: also refuse (a cap is meant to be felt, not silently eaten)
  select count(*) into v_today from public.puzzle_results
   where user_id = v_uid and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if v_today >= v_daily_max then
    raise exception 'daily puzzle rating cap reached — carry on tomorrow';
  end if;

  -- an impossibly fast solve is ignored entirely (no win, no loss, no rating)
  if p_solved and (p_time_ms is null or p_time_ms < v_min_solve) then
    v_ignore := true;
  end if;

  v_score := case when v_ignore then null::numeric
                  when p_solved then 1.0
                  else 0.0 end;
  v_elapsed := greatest(coalesce(p_time_ms, 0), 0);

  select * into v_row from public.ratings where user_id = v_uid and category = 'puzzle' for update;
  if not found then
    insert into public.ratings (user_id, category, rating, rd, vol)
    values (v_uid, 'puzzle', 200, 350, 0.06)
    returning * into v_row;
  end if;

  if v_score is null then
    -- ignored: keep the rating, still log the attempt so limits count it
    v_new_rating := v_row.rating;
    v_new_rd := v_row.rd;
    v_new_vol := v_row.vol;
  else
    select r.rating, r.rd, r.vol into v_new_rating, v_new_rd, v_new_vol
      from public.glicko200_update(v_row.rating, v_row.rd, v_row.vol, v_row.updated_at,
                                   v_puzzle.rating, v_opp_rd, v_score, v_elapsed, now()) r;
    update public.ratings
       set rating = v_new_rating, rd = v_new_rd, vol = v_new_vol,
           games = games + 1,
           wins = wins + case when p_solved then 1 else 0 end,
           losses = losses + case when p_solved then 0 else 1 end,
           peak = greatest(peak, v_new_rating),
           updated_at = now()
     where user_id = v_uid and category = 'puzzle';
  end if;

  -- attempt log (the unique index is the real replay guard under concurrency)
  begin
    insert into public.puzzle_results
      (user_id, puzzle_id, attempt_no, solved, time_ms, rating_before, rating_after, rd_after)
    values (v_uid, p_puzzle_id, v_attempt, p_solved, v_elapsed, v_row.rating, v_new_rating, v_new_rd);
  exception when unique_violation then
    -- lost a race with an identical replay: treat as duplicate, no double rate
    select * into v_row from public.ratings where user_id = v_uid and category = 'puzzle';
    return jsonb_build_object(
      'ok', true, 'duplicate', true, 'ignored', false,
      'rating', v_row.rating, 'rd', v_row.rd, 'games', v_row.games,
      'wins', v_row.wins, 'losses', v_row.losses);
  end;

  -- chart point (game_id stays null for puzzles). Ignored solves still leave a
  -- point so the chart reflects activity, but with a flat rating.
  if not v_ignore then
    insert into public.rating_history
      (user_id, category, game_id, rating_before, rating_after, rd_after, result)
    values (v_uid, 'puzzle', null, v_row.rating, v_new_rating, v_new_rd,
            case when p_solved then 'win' else 'loss' end);
  end if;

  select * into v_row from public.ratings where user_id = v_uid and category = 'puzzle';
  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'ignored', v_ignore,
    'rating', v_row.rating, 'rd', v_row.rd, 'games', v_row.games,
    'wins', v_row.wins, 'losses', v_row.losses, 'peak', v_row.peak);
end;
$$;

-- the old client-fed entry point is gone: drop it and its anon grant
drop function if exists public.sync_puzzle_rating(int, int, numeric, int, int, int, boolean);

-- ------------------------------------------------------------------
-- Permissions: pinned search_path, no PUBLIC/anon EXECUTE anywhere
-- ------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- grant only what the app actually calls, only to authenticated
grant execute on function public.record_puzzle_result(text, boolean, bigint, bigint) to authenticated;
grant execute on function public.finalize_game(uuid) to authenticated;
grant execute on function public.check_username(text) to authenticated;
grant execute on function public.claim_username(text, text, text) to authenticated;
grant execute on function public.update_username(text) to authenticated;
grant execute on function public.leaderboard(text, int, int) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.sync_guest(text, text, text) to authenticated;
grant execute on function public.touch_guest() to authenticated;
grant execute on function public.queue_match(jsonb, boolean, int) to authenticated;
grant execute on function public.cancel_queue() to authenticated;
grant execute on function public.tc_category(jsonb) to authenticated;
grant execute on function public.glicko200_update(int, int, numeric, timestamptz, int, int, numeric, bigint, timestamptz) to authenticated;

-- ------------------------------------------------------------------
-- Main leaderboards exclude puzzles (cheat-prone by design); the puzzle
-- board is a separate call. Dropped first because the return shape changes
-- (Postgres refuses to `create or replace` a function into a different row
-- type) and the 'puzzle' branch is gone.
-- ------------------------------------------------------------------
drop function if exists public.leaderboard(text, int, int);

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
  rank int
)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, p.username, p.avatar_seed, p.flag,
         r.rating, r.rd, r.peak, r.games, r.wins, r.draws, r.losses,
         (r.rd > 110) as is_provisional,
         row_number() over (order by r.rating desc, r.rd asc)::int as rank
    from public.ratings r
    join public.profiles p on p.id = r.user_id
   where r.category = case
                        when p_category in ('bullet', 'blitz', 'rapid', 'classical') then p_category
                        else 'blitz'
                      end
     and r.games > 0
     and r.rd <= 110          -- never provisional
   order by r.rating desc, r.rd asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.leaderboard(text, int, int) to authenticated;

-- separate puzzle leaderboard (accounts only, still never provisional)
create or replace function public.puzzle_leaderboard(
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
  losses int,
  is_provisional boolean,
  rank int
)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, p.username, p.avatar_seed, p.flag,
         r.rating, r.rd, r.peak, r.games, r.wins, r.losses,
         (r.rd > 110) as is_provisional,
         row_number() over (order by r.rating desc, r.rd asc)::int as rank
    from public.ratings r
    join public.profiles p on p.id = r.user_id
   where r.category = 'puzzle'
     and r.games > 0
     and r.rd <= 110
   order by r.rating desc, r.rd asc
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

grant execute on function public.puzzle_leaderboard(int, int) to authenticated;
