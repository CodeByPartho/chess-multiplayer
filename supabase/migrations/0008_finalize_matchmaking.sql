-- 0008: server-side rating finalization (Glicko-2 in SQL), matchmaking v2,
-- and the rating-farming downgrade.
--
-- finalize_game() is THE only path that changes a rating after a game:
--   * reads the game + both ratings rows from the database (never from the
--     client), computes Glicko-2 with the same maths as the client preview
--     (src/lib/chess/rating200.ts — offset200 ≡ 1500, tau/vol clamps),
--   * requires the game to be over, rated, with >= 2 moves by EACH player,
--   * writes both players' ratings and both history rows in ONE transaction,
--   * is idempotent: the (game_id, user_id) unique constraint plus the game
--     row lock mean a retry — or a second caller — can never apply twice.
--
-- queue_match: matches by category (tc formula) + rating with a window of
-- ±100 widening by 50 every 5s (cap 600, configurable), seeding the rating
-- from the ratings table rather than trusting the client.
--
-- games insert trigger: after 4 rated games vs the same opponent in 24h,
-- further games are forced casual (casual_reason tells both players why).
--
-- Apply with: supabase db push   (or paste into the SQL editor)

begin;

-- ============================================================ schema tweaks

alter table public.lobby add column if not exists first_seen timestamptz not null default now();
alter table public.games add column if not exists casual_reason text;

-- both seats may be empty only for finished games (anonymized archives)
alter table public.games drop constraint if exists game_needs_player;
alter table public.games add constraint game_needs_player
  check (white_id is not null or black_id is not null or status in ('over', 'aborted'));

-- ============================================================ realtime: live rating pushes

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ratings'
  ) then
    alter publication supabase_realtime add table public.ratings;
  end if;
end $$;

-- ============================================================ category of a time control

-- Mirror of src/lib/chess/categories.ts: base + 40 * increment seconds.
create or replace function public.tc_category(p_tc jsonb)
returns text
language sql
immutable
as $$
  select case
    when coalesce((p_tc ->> 'base')::numeric, 0) / 1000
       + 40 * coalesce((p_tc ->> 'inc')::numeric, 0) / 1000 < 180 then 'bullet'
    when coalesce((p_tc ->> 'base')::numeric, 0) / 1000
       + 40 * coalesce((p_tc ->> 'inc')::numeric, 0) / 1000 < 480 then 'blitz'
    when coalesce((p_tc ->> 'base')::numeric, 0) / 1000
       + 40 * coalesce((p_tc ->> 'inc')::numeric, 0) / 1000 < 1500 then 'rapid'
    else 'classical'
  end;
$$;

-- ============================================================ Glicko-2 step (SQL port)

-- Exact port of src/lib/chess/glicko.ts + the 200-scale adapter
-- (rating200.ts): mu = (rating - 200) / 173.7178, input sigma clamp
-- [0.02, 0.1], volatility iteration with tau = 0.5, output clamps
-- rating >= 100, rd in [45, 350], vol in [0.01, 0.5].
create or replace function public.glicko200_update(
  p_rating int,
  p_rd int,
  p_vol numeric,
  p_updated_at timestamptz,
  p_opp_rating int,
  p_opp_rd int,
  p_score numeric,
  p_elapsed_ms bigint,
  p_now timestamptz
)
returns table (rating int, rd int, vol numeric)
language plpgsql
set search_path = public
as $$
declare
  SCALE constant double precision := 173.7178;
  TAU double precision := 0.5;
  PHI_LIMIT double precision := 350.0 / 173.7178;
  mu double precision;
  phi double precision;
  sigma double precision;
  years double precision;
  muj double precision;
  phij double precision;
  gj double precision;
  ej double precision;
  v double precision;
  delta_prime double precision;
  a double precision;
  lo double precision;
  hi double precision;
  mid double precision;
  fx double precision;
  ex2 double precision;
  iter int := 0;
  raw_vol double precision;
  ln_vol double precision;
  new_vol double precision;
  phi_star double precision;
  new_phi double precision;
  new_mu double precision;
  out_rating bigint;
  out_rd bigint;
begin
  mu := (p_rating - 200) / SCALE; -- displayed 200 ≡ internal 1500
  phi := p_rd / SCALE;
  sigma := least(
    0.1,
    greatest(0.02, case when p_vol is null or p_vol = 0 then 0.06 else p_vol::double precision end)
  );

  -- inactivity grows rd toward the 350 default (max 4 years, as in the TS port)
  years := least(4.0, greatest(0.0, coalesce(p_elapsed_ms, 0)) / (365.25 * 24.0 * 3600.0 * 1000.0));
  phi := least(sqrt(phi * phi + years * power(0.0655, 2)), PHI_LIMIT);

  muj := (p_opp_rating - 200) / SCALE;
  phij := greatest(0.05, p_opp_rd / SCALE);
  gj := 1.0 / sqrt(1.0 + (3.0 * phij * phij) / (pi() * pi()));
  ej := 1.0 / (1.0 + exp(-gj * (mu - muj)));

  v := 1.0 / (gj * gj * ej * (1.0 - ej));
  delta_prime := v * gj * (p_score - ej);

  -- volatility iteration (Illinois algorithm, bracket + bisect)
  a := ln(sigma * sigma);
  if (delta_prime / phi) * (delta_prime / phi) > phi * phi + sigma * sigma then
    lo := a;
    hi := ln((delta_prime / phi) * (delta_prime / phi) - phi * phi - sigma * sigma);
  else
    lo := a;
    hi := a;
  end if;
  while iter < 100 and hi - lo > 1e-10 loop
    mid := (lo + hi) / 2.0;
    ex2 := exp(mid);
    fx := (ex2 * (delta_prime * delta_prime - phi * phi - sigma * sigma - ex2))
          / (2.0 * power(phi * phi + sigma * sigma + ex2, 2))
          - (mid - a) / (sigma * sigma);
    if fx < 0 then lo := mid; else hi := mid; end if;
    iter := iter + 1;
  end loop;

  -- |ln σ′ − ln σ| ≤ τ (tau clamp — the regression the TS port fixed)
  raw_vol := exp((lo + hi) / 2.0);
  ln_vol := least(greatest(a, ln(raw_vol)), a + TAU * TAU);
  new_vol := least(0.5, greatest(0.01, exp(ln_vol)));

  phi_star := sqrt(phi * phi + new_vol * new_vol);
  new_phi := least(PHI_LIMIT, 1.0 / sqrt(1.0 / (phi_star * phi_star) + 1.0 / v));
  new_mu := mu + new_phi * new_phi * (delta_prime / v);

  -- floor(x + 0.5) matches JS Math.round for both signs
  out_rating := floor(new_mu * SCALE + 200.0 + 0.5)::bigint;
  out_rd := floor(new_phi * SCALE + 0.5)::bigint;

  rating := least(3000, greatest(100, out_rating))::int;
  rd := greatest(45, least(350, out_rd))::int;
  vol := round(new_vol::numeric, 4);
  return next;
end;
$$;

-- ============================================================ finalize a rated game

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

-- ============================================================ farming downgrade (insert trigger)

create or replace function public.apply_game_rules()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cnt int;
begin
  if new.rated and new.white_id is not null and new.black_id is not null then
    -- one history row per game from white's side = number of rated games
    select count(*) into cnt
      from public.rating_history rh
     where rh.user_id = new.white_id
       and rh.opponent_id = new.black_id
       and rh.created_at > now() - interval '24 hours'
       and rh.category = public.tc_category(new.tc);
    if cnt >= 4 then
      new.rated := false;
      new.casual_reason := 'farming_limit';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists games_apply_rules on public.games;
create trigger games_apply_rules
  before insert on public.games
  for each row execute function public.apply_game_rules();

-- ============================================================ queue_match v2

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

  base := (p_tc->>'base')::bigint;
  inc := (p_tc->>'inc')::bigint;
  if base is null or base < 10000 or base > 10800000
     or inc is null or inc < 0 or inc > 60000
     or p_tc->>'type' is null then
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

commit;
