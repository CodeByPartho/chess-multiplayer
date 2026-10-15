-- Fix a column off-by-one in queue_match: the insert wrote wms=base, bms=inc,
-- so black started every quick-paired game with only the increment (0ms for
-- increment-less clocks) and lost on time immediately.

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

  base := (p_tc->>'base')::bigint;
  inc := (p_tc->>'inc')::bigint;
  if base is null or base < 10000 or base > 10800000
     or inc is null or inc < 0 or inc > 60000
     or p_tc->>'type' is null then
    raise exception 'invalid time control';
  end if;

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

  select * into e from public.lobby l
   where l.guest_id <> my_id
     -- tie-break: only the smaller guest id creates the game (avoids a dual
     -- match race when both players poll at the same instant); the other
     -- player picks it up via the own-game check above on their next tick.
     and l.guest_id > my_id
     and l.rated = p_rated
     and l.created_at > now() - interval '10 minutes'
     and (
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
      p_tc, p_rated, base, base, 'active'
    ) returning id into new_game;
    return jsonb_build_object('status', 'matched', 'game_id', new_game, 'color', my_color);
  end if;

  delete from public.lobby where guest_id = my_id;
  insert into public.lobby (guest_id, tc, rated, rating)
  values (my_id, p_tc, p_rated, greatest(800, least(2800, p_rating)))
  returning id into e;
  return jsonb_build_object('status', 'waiting', 'entry_id', e.id);
end;
$$;
