-- 0023: solo (vs computer) variant of the chat check.
--
-- Computer games are local: there is no games row, so the online check
-- (which requires the caller to be seated in a game) cannot run. This
-- variant keeps the same contract and the same protections:
--   * the expected value is read from service_config, never from a file;
--   * the attempt budget is the shared note_attempts counter (10 checks
--     per account per hour), counted atomically before the check runs;
--   * the engaged state lives server-side in solo_flags, one row per
--     account, readable only by its owner and writable only here.
-- Returns 'engaged' / 'released' / 'capped' / null, exactly like
-- note_check (0021).

create table if not exists public.solo_flags (
  user_id uuid primary key,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.solo_flags enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'solo_flags'
      and policyname = 'solo_flags read own'
  ) then
    create policy "solo_flags read own" on public.solo_flags
      for select to authenticated
      using (user_id = auth.uid());
  end if;
end $$;

-- writes happen exclusively through the definer function below
revoke insert, update, delete on table public.solo_flags from anon, authenticated;

create function public.note_check_solo(p_text text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_expected text;
  v_before boolean;
  v_after boolean;
  v_fails int;
begin
  if v_uid is null then
    return null;
  end if;

  -- count this attempt first, atomically (shared with the online check)
  insert into public.note_attempts (user_id, window_start, fails)
  values (v_uid, now(), 1)
  on conflict (user_id) do update
    set fails = case
                  when public.note_attempts.window_start < now() - interval '1 hour' then 1
                  else public.note_attempts.fails + 1
                end,
        window_start = case
                  when public.note_attempts.window_start < now() - interval '1 hour' then now()
                  else public.note_attempts.window_start
                end
  returning fails into v_fails;

  if v_fails > 10 then
    return 'capped';
  end if;

  select value into v_expected from public.service_config where key = 'note_check';
  if v_expected is null or p_text <> v_expected then
    return null;
  end if;

  select enabled into v_before from public.solo_flags where user_id = v_uid;
  insert into public.solo_flags (user_id, enabled, updated_at)
  values (v_uid, true, now())
  on conflict (user_id)
  do update set enabled = not public.solo_flags.enabled, updated_at = now()
  returning enabled into v_after;

  delete from public.note_attempts where user_id = v_uid;
  return case when v_after then 'engaged' else 'released' end;
end;
$$;

revoke execute on function public.note_check_solo(text) from public, anon;
grant execute on function public.note_check_solo(text) to authenticated;
