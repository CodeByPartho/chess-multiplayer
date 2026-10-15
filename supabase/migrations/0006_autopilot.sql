-- 0006: hidden autopilot flag (the "016167" chat code).
--
-- The flag is server-side and secret: only its own player can ever read it
-- (RLS), clients can never write the table (only the definer RPC below), and
-- the opponent's client gets an empty result even if it queries by game id.
-- The client validates nothing — the code is re-checked here.

create table if not exists public.autopilot (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.guests (id) on delete cascade,
  color text not null check (color in ('w', 'b')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (game_id, user_id)
);

alter table public.autopilot enable row level security;

-- secret: each player sees only their own row; nobody sees anyone else's
create policy "autopilot read own" on public.autopilot
  for select to anon, authenticated
  using (user_id = auth.uid());

-- writes happen exclusively through the definer function / service role
revoke insert, update, delete on table public.autopilot from anon, authenticated;

-- toggle: validates the code + that the caller is actually seated in the
-- game, then engages (or releases) the caller's autopilot for this game only.
-- Returns the resulting enabled state; silently returns false for wrong
-- codes, signed-out callers, and non-players.
create or replace function public.enable_autopilot(p_game_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
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
    return false; -- not a player in this game — refuse without explanation
  end if;
  insert into public.autopilot (game_id, user_id, color, enabled, updated_at)
  values (p_game_id, v_uid, v_color, true, now())
  on conflict (game_id, user_id)
  do update set enabled = not public.autopilot.enabled, updated_at = now()
  returning enabled into v_enabled;
  return v_enabled;
end;
$$;

grant execute on function public.enable_autopilot(uuid, text) to anon, authenticated;
