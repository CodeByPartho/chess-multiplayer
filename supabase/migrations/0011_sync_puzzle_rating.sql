-- ============================================================
-- 0011: puzzle ratings join the server-side picture
-- ============================================================
-- Puzzles have no opponent to verify against (the library lives in the
-- client), so the Glicko-2 maths runs locally at the 200 scale — but for
-- signed-in users (guests included; accounts keep it after upgrade) the
-- result is pushed through this RPC, which owns the only write path into
-- ratings/rating_history (both are RLS-blocked for clients). A monotonic
-- `games` guard makes replays / out-of-order syncs no-ops, so the value
-- can never move backwards.

-- puzzle chart points carry no game row
alter table public.rating_history alter column game_id drop not null;

create or replace function public.sync_puzzle_rating(
  p_rating int,
  p_rd int,
  p_vol numeric,
  p_wins int,
  p_losses int,
  p_games int,
  p_solved boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rating int;
  v_rd int;
  v_vol numeric;
  v_games int;
  v_old record;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- clamp into the schema's own bounds instead of erroring on drift
  v_rating := least(greatest(coalesce(p_rating, 200), 100), 3000);
  v_rd := least(greatest(coalesce(p_rd, 350), 45), 350);
  v_vol := least(greatest(coalesce(p_vol, 0.06), 0.01), 0.5);
  v_games := least(greatest(coalesce(p_games, 0),
                             greatest(coalesce(p_wins, 0), 0) + greatest(coalesce(p_losses, 0), 0)),
                    500000);

  select games, rating into v_old
    from public.ratings
   where user_id = v_uid and category = 'puzzle'
     for update;

  insert into public.ratings (user_id, category, rating, rd, vol, games, wins, draws, losses, peak, updated_at)
  values (v_uid, 'puzzle', v_rating, v_rd, v_vol, v_games,
          greatest(coalesce(p_wins, 0), 0), 0, greatest(coalesce(p_losses, 0), 0),
          v_rating, now())
  on conflict (user_id, category) do update
    set rating    = case when public.ratings.games < excluded.games then excluded.rating    else public.ratings.rating end,
        rd        = case when public.ratings.games < excluded.games then excluded.rd        else public.ratings.rd end,
        vol       = case when public.ratings.games < excluded.games then excluded.vol       else public.ratings.vol end,
        wins      = case when public.ratings.games < excluded.games then excluded.wins      else public.ratings.wins end,
        losses    = case when public.ratings.games < excluded.games then excluded.losses    else public.ratings.losses end,
        games     = greatest(public.ratings.games, excluded.games),
        peak      = greatest(public.ratings.peak,
                             case when public.ratings.games < excluded.games then excluded.rating else public.ratings.rating end),
        updated_at = now();

  -- one chart point per accepted advance (replays are rejected above)
  if v_old.games is null or v_old.games < v_games then
    insert into public.rating_history (user_id, category, game_id, rating_before, rating_after, rd_after, result, created_at)
    values (v_uid, 'puzzle', null,
            coalesce(v_old.rating, v_rating), v_rating, v_rd,
            case when p_solved is distinct from false then 'win' else 'loss' end,
            now());
  end if;

  return jsonb_build_object('rating', v_rating, 'rd', v_rd, 'games', v_games,
                            'advanced', v_old.games is null or v_old.games < v_games);
end;
$$;

-- only the (anonymous or upgraded) player themselves may push puzzle points
revoke all on function public.sync_puzzle_rating(int, int, numeric, int, int, int, boolean) from public, anon;
grant execute on function public.sync_puzzle_rating(int, int, numeric, int, int, int, boolean) to authenticated;
-- guests are anonymous auth users: same execution grant as authenticated covers
-- them (their role IS authenticated after sign-in_anonymous; kept explicit for
-- clarity if anon sessions are ever enabled).
grant execute on function public.sync_puzzle_rating(int, int, numeric, int, int, int, boolean) to anon;
