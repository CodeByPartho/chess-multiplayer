-- 0018: avatar uploads — a profile can point at an uploaded image.
--
-- profiles.avatar_path holds the storage path of the player's uploaded
-- avatar (avatars/<uid>/<file>); the public URL is derived client-side
-- from the public-read `avatars` bucket. Display preference is
-- avatar_path -> avatar_seed -> initials (see src/components/Avatar.tsx).
-- The bucket itself and its write-only-into-your-own-folder policies ship
-- with the security migration.
--
-- The update policy is re-stated with one extra condition: a profile may
-- only reference an avatar inside its own storage folder. Storage writes
-- are policy-guarded too, so a path outside avatars/<uid>/ can never
-- resolve to another player's upload.
--
-- Apply with: supabase db push   (or paste into the SQL editor)

begin;

alter table public.profiles add column if not exists avatar_path text;

-- owners may set/clear the path themselves, like avatar_seed and flag
grant update (avatar_path) on table public.profiles to authenticated;

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (auth.uid() = id)
  with check (
    auth.uid() = id
    and (
      avatar_path is null
      or (
        char_length(avatar_path) <= 200
        and avatar_path like (auth.uid())::text || '/%'
      )
    )
  );

commit;
