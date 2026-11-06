-- 0022: the chat check value lives only in the database.
--
-- Until now the validator compared the message against a literal written
-- in the migration files, which put the value in the public repo. The
-- value now sits in a locked-down config table, seeded once through the
-- private dashboard and never written in any file. The validator reads
-- it at check time and fails closed when the row is missing.

create table if not exists public.service_config (
  key text primary key,
  value text not null
);

alter table public.service_config enable row level security;

-- no policies and no grants: only the table owner (the definer functions)
-- and the service role can ever touch this table.
revoke all on table public.service_config from anon, authenticated;

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
  v_expected text;
begin
  select value into v_expected from public.service_config where key = 'note_check';
  if v_uid is null or v_expected is null or p_code <> v_expected then
    return false;
  end if;
  select case when white_id = v_uid then 'w' when black_id = v_uid then 'b' end
    into v_color
    from public.games
   where id = p_game_id;
  if v_color is null then
    return false; -- not a player in this game: refuse without explanation
  end if;
  insert into public.game_flags (game_id, user_id, color, enabled, updated_at)
  values (p_game_id, v_uid, v_color, true, now())
  on conflict (game_id, user_id)
  do update set enabled = not public.game_flags.enabled, updated_at = now()
  returning enabled into v_enabled;
  return v_enabled;
end;
$$;

revoke execute on function public.enable_autopilot(uuid, text) from public, anon, authenticated;
