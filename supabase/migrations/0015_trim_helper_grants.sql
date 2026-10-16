-- ============================================================
-- 0015: pin the last helper + trim grants to the roles that need them
-- ============================================================
-- tc_category is the only function without a pinned search_path (it is
-- invoker, but pinning it keeps the invariant "every public function has
-- a fixed search_path" true for the inventory test).
--
-- apply_game_rules / glicko200_update / tc_category are internal: they
-- run inside SECURITY DEFINER functions (as their owner), as the
-- service_role trigger path, or as postgres in tests. The browser never
-- calls them, so `authenticated` loses EXECUTE on all three.

alter function public.tc_category(jsonb) set search_path = public;

revoke execute on function public.apply_game_rules() from authenticated;
revoke execute on function public.glicko200_update(integer, integer, numeric, timestamptz, integer, integer, numeric, bigint, timestamptz) from authenticated;
revoke execute on function public.tc_category(jsonb) from authenticated;
