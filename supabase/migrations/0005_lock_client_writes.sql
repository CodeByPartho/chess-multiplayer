-- 0005: lock down client-side writes.
--
-- Guests read everything they need (games are world-readable, guests are
-- world-readable) but must never write game state (moves, clocks, results)
-- or ratings from the browser: those writes only ever happen in SECURITY
-- DEFINER RPCs (sync_guest, touch_guest, queue_*) and service-role Edge
-- Functions (game-create/join/action/move-loss). Closing the direct paths
-- removes the "edit my ratings from devtools" hole without touching any
-- server flow.
--
-- Apply with: supabase db push   (or paste into the SQL editor)

begin;

-- clients may not touch game rows at all (only service-role functions do)
revoke insert, update, delete on table public.games from anon, authenticated;

-- clients may not touch lobby rows directly either (queue_* RPCs handle it)
revoke insert, update, delete on table public.lobby from anon, authenticated;

-- guests: keep reads open, but writes only through the definer RPCs.
-- revoke the broad table-level grants, then re-grant only the profile
-- columns so a future "edit my name" feature can use RLS without ever
-- being able to write ratings, id, or created_at from the client.
revoke insert, update, delete on table public.guests from anon, authenticated;
grant insert (id, username, avatar_seed, flag, last_seen) on table public.guests to authenticated;
grant update (username, avatar_seed, flag, last_seen) on table public.guests to authenticated;

commit;

-- realtime: the client subscribes per game id to games UPDATEs (moves,
-- clocks, status flips). games is already in the publication from
-- 0001_init.sql; moves live in the games row (jsonb), so no separate
-- moves table exists or is needed. Verify with:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public';
