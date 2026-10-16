-- ============================================================
-- 0014: close the EXECUTE gap left by default privileges
-- ============================================================
-- Supabase's default privileges grant EXECUTE on every NEW function to
-- anon (directly, not just via PUBLIC). 0013's revoke loop ran before
-- leaderboard/puzzle_leaderboard were re-created, so those two picked the
-- grant right back up. This migration locks the whole public schema down:
--
--   * SECURITY DEFINER functions : EXECUTE for authenticated (+service_role
--     where the Edge Functions need it) only — never PUBLIC, never anon.
--   * pure helper functions (glicko200_update, tc_category) and the
--     trigger function (apply_game_rules) : also PUBLIC/anon revoked —
--     internal callers run as postgres/service_role/definer, which keep
--     their direct grants.
--
-- Clients are unaffected: every RPC the browser calls runs as
-- `authenticated` (guest sessions are anonymous *sign-ins*), and
-- leaderboard becomes strictly signed-in-only, which is the requirement.

revoke execute on function public.leaderboard(text, integer, integer) from public, anon;
revoke execute on function public.puzzle_leaderboard(integer, integer) from public, anon;
revoke execute on function public.apply_game_rules() from public, anon;
revoke execute on function public.glicko200_update(integer, integer, numeric, timestamptz, integer, integer, numeric, bigint, timestamptz) from public, anon;
revoke execute on function public.tc_category(jsonb) from public, anon;
