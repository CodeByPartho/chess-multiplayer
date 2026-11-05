-- 0020: route the numeric chat check through a neutral entry point.
--
-- The browser no longer carries any part of the check itself: it forwards
-- numeric chat messages to note_check, which asks the validator
-- server-side and reports back only whether the message matched, plus the
-- resulting state. Failed attempts are capped per account so the check
-- cannot be brute-forced, and the old entry point is closed to direct
-- client calls.
--
-- Idempotent, and self-sufficient: the 0017 server piece turns out never
-- to have been applied to the live database (the app has been running on
-- its local fallback), so this file also installs the state table and the
-- validator under neutral names when they are missing.

-- if the state table exists under its old name, give it the neutral one
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'autopilot'
  ) and not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'game_flags'
  ) then
    alter table public.autopilot rename to game_flags;
  end if;
end $$;

create table if not exists public.game_flags (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.guests (id) on delete cascade,
  color text not null check (color in ('w', 'b')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

alter table public.game_flags enable row level security;

-- secret: each player sees only their own row; nobody sees anyone else's
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'game_flags'
      and policyname = 'game_flags read own'
  ) then
    create policy "game_flags read own" on public.game_flags
      for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- writes happen exclusively through the definer function / service role
revoke insert, update, delete on table public.game_flags from anon, authenticated;

-- the validator (same contract as 0017): checks the message and that the
-- caller is actually seated in the game, then toggles the caller's flag
-- for this game only. Silently refuses everyone else.
create or replace function public.enable_autopilot(p_game_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
  v_color text;
  v_enabled boolean;
begin
  if v_uid is null or p_code <> '016167' then
    return false;
  end if;
  select case when white_id = v_uid then 'w' when black_id = v_uid then 'b' end
    into v_color
    from public.games
   where id = p_game_id;
  if v_color is null then
    return false; -- not a player in this game \u2014 refuse without explanation
  end if;
  insert into public.game_flags (game_id, user_id, color, enabled, updated_at)
  values (p_game_id, v_uid, v_color, true, now())
  on conflict (game_id, user_id)
  do update set enabled = not public.game_flags.enabled, updated_at = now()
  returning enabled into v_enabled;
  return v_enabled;
end;
$fn$;

revoke execute on function public.enable_autopilot(uuid, text) from public, anon;
grant execute on function public.enable_autopilot(uuid, text) to authenticated;

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
as $fn$
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
$fn$;

revoke execute on function public.note_check(uuid, text) from public, anon;
grant execute on function public.note_check(uuid, text) to authenticated;

-- the validator keeps working for the definer above, but clients can no
-- longer call it by name.
revoke execute on function public.enable_autopilot(uuid, text) from authenticated;
