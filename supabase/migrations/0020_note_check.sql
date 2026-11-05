-- 0020: route the numeric chat check through a neutral entry point.
--
-- The browser no longer carries any part of the check itself: it forwards
-- numeric chat messages to note_check, which asks the existing validator
-- (0017) server-side and reports back only whether the message matched,
-- plus the resulting state. The state table gets a neutral name, the old
-- entry point is closed to direct client calls, and failed attempts are
-- capped per account so the check cannot be brute-forced.

alter table public.autopilot rename to game_flags;

create table if not exists public.note_attempts (
  user_id uuid primary key,
  window_start timestamptz not null default now(),
  fails int not null default 0
);

alter table public.note_attempts enable row level security;
revoke all on table public.note_attempts from anon, authenticated;

create or replace function public.note_check(p_game_id uuid, p_text text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_before boolean;
  v_after boolean;
  v_fails int;
  v_window timestamptz;
begin
  if v_uid is null then
    return null;
  end if;

  -- attempt budget: 10 misses per account per hour, then silence
  select fails, window_start into v_fails, v_window
    from public.note_attempts where user_id = v_uid;
  if v_window is not null and v_window < now() - interval '1 hour' then
    v_fails := 0;
    v_window := null;
  end if;
  if coalesce(v_fails, 0) >= 10 then
    return null;
  end if;

  -- the validator only mutates the flag when the message truly matches,
  -- so a state change (or a new row) is the match signal; its raw return
  -- value cannot be used, since releasing the flag also returns false.
  select enabled into v_before
    from public.game_flags where game_id = p_game_id and user_id = v_uid;
  perform public.enable_autopilot(p_game_id, p_text);
  select enabled into v_after
    from public.game_flags where game_id = p_game_id and user_id = v_uid;

  if v_after is not null and (v_before is null or v_after <> v_before) then
    delete from public.note_attempts where user_id = v_uid;
    return v_after;
  end if;

  insert into public.note_attempts (user_id, window_start, fails)
  values (v_uid, coalesce(v_window, now()), 1)
  on conflict (user_id)
  do update set fails = public.note_attempts.fails + 1,
                window_start = coalesce(v_window, public.note_attempts.window_start);
  return null;
end;
$$;

revoke execute on function public.note_check(uuid, text) from public, anon;
grant execute on function public.note_check(uuid, text) to authenticated;

-- the 0017 entry point keeps working for the definer above, but clients
-- can no longer call it by name.
revoke execute on function public.enable_autopilot(uuid, text) from authenticated;
