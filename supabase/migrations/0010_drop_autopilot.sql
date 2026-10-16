-- 0010: remove the hidden autopilot entirely.
--
-- The "016167" chat code let a player engage a full-strength engine for
-- their own moves in human-vs-human games. The product requirements for the
-- accounts & ratings era explicitly ban secret chat commands and engine
-- assistance in human play, so the flag table and its toggle RPC are gone;
-- every other path (chat, moves) was already neutral without them.

drop function if exists public.enable_autopilot(uuid, text);
drop table if exists public.autopilot cascade;
