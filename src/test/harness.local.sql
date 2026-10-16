-- ============================================================
-- Test harness bootstrap for a VANILLA PostgreSQL (no Supabase).
-- Recreates just enough of the Supabase runtime surface for the
-- migrations to apply unmodified and behave as they do in production:
--   * the three API roles + Supabase-style default privileges
--   * the realtime publication migrations add tables to
--   * the auth schema: auth.users (FK target) and auth.uid()
-- Idempotent: every statement tolerates already-existing objects, so the
-- same file is safe on a fresh embedded database and on a dedicated test
-- Supabase project alike.

-- ------------------------------------------------- API roles
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

-- Supabase grants table/FUNCTION access to the API roles by default;
-- row-level security is what ultimately protects the data. Mirroring that
-- keeps the RLS tests faithful to production.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

-- ------------------------------------------------- realtime publication
do $$
begin
  -- catalog is the singular pg_publication table (there is no pg_publications view)
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ------------------------------------------------- auth schema
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

-- standard Supabase auth.uid(): subject claim from the JWT claims GUC,
-- which tests set with set_config('request.jwt.claims', ...)
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
