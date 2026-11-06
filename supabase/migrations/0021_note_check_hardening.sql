-- 0021: harden note_check after review.
--
-- Three changes over 0020:
-- 1. The result is now text ('engaged' / 'released' / 'capped' / null) so
--    the client can tell "matched", "ordinary message" and "do not
--    broadcast" apart. Under 0020 a capped check returned null, which the
--    client read as "ordinary", and a real code typed after the budget ran
--    out would have been broadcast to the opponent.
-- 2. The attempt budget is counted atomically: one upsert increments the
--    counter (and rolls the hour window) before the check runs, so
--    parallel calls cannot slip past the cap between read and increment.
-- 3. A match clears the counter, as before.

drop function if exists public.note_check(uuid, text);

create function public.note_check(p_game_id uuid, p_text text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_before boolean;
  v_after boolean;
  v_fails int;
begin
  if v_uid is null then
    return null;
  end if;

  -- count this attempt first, atomically: 10 checks per account per hour
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
    return case when v_after then 'engaged' else 'released' end;
  end if;

  return null;
end;
$$;

revoke execute on function public.note_check(uuid, text) from public, anon;
grant execute on function public.note_check(uuid, text) to authenticated;
