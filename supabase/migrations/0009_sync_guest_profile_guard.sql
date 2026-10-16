-- ============================================================
-- 0009: sync_guest must follow the claimed profile
-- ============================================================
-- A registered account's display name lives in profiles.username (changed
-- only through claim_username / update_username). The client still calls
-- sync_guest on every session start with the *local* guest identity, so an
-- unguarded upsert would overwrite the claimed name back to "Guest_XYZ".
-- When a profile row exists, the profile is now the single source of truth
-- for the guests row; local values are only used for guests and accounts
-- that have not picked a username yet.

create or replace function public.sync_guest(p_username text, p_avatar_seed text, p_flag text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p_profile record;
begin
  select username, avatar_seed, flag into p_profile
    from public.profiles
   where id = auth.uid();

  insert into public.guests (id, username, avatar_seed, flag)
  values (auth.uid(),
          coalesce(p_profile.username, left(trim(p_username), 20)),
          coalesce(p_profile.avatar_seed, left(p_avatar_seed, 64)),
          case
            when p_profile.username is not null then p_profile.flag
            when p_flag is null or p_flag = '' then null
            else left(p_flag, 8)
          end)
  on conflict (id) do update
    set username = coalesce(p_profile.username, excluded.username),
        avatar_seed = coalesce(p_profile.avatar_seed, excluded.avatar_seed),
        flag = case
                 when p_profile.username is not null then p_profile.flag
                 else excluded.flag
               end,
        last_seen = now();
end;
$$;

-- claim_username / update_username keep mirroring into guests (see 0007);
-- with this guard the two writers can no longer fight each other.
