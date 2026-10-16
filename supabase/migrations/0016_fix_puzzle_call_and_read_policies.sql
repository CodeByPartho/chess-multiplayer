-- ============================================================
-- 0016: fixes found by running the integration suite on the test DB
-- ============================================================

-- 1. record_puzzle_result called glicko200_update() with v_opp_rd typed
--    bigint while the helper takes int for p_opp_rd: bigint -> int is an
--    assignment cast, not an implicit one, so the function resolution
--    failed at runtime with 42883 the moment anyone actually solved a
--    puzzle. (0013 was applied but never executed against a database —
--    the test database caught it.) Only the variable type changes.
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
  v_opp_rd int;                       -- must match glicko200_update's p_opp_rd
  v_recent bigint;
  v_today bigint;
  v_attempt bigint;
  v_score numeric;
  v_elapsed bigint;
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

  -- chart point (game_id stays null for puzzles). Ignored solves are not
  -- rated, so they never reach this branch.
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

-- 2. ratings and rating_history had RLS enabled but NO select policy:
--    every direct client read (header badges, profile rating cards, the
--    rating chart, profile stats) silently returned zero rows. Ratings and
--    history are public data by design — reads stay open, writes remain
--    locked to the SECURITY DEFINER functions (0005/0007 revokes).
drop policy if exists "ratings are public" on public.ratings;
create policy "ratings are public" on public.ratings
  for select using (true);

drop policy if exists "rating history is public" on public.rating_history;
create policy "rating history is public" on public.rating_history
  for select using (true);
