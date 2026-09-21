-- User profiles + roles.
-- This table was previously created by hand in the original Supabase
-- project and was never captured in a migration, so a fresh project (like
-- one set up from this repo today) has no `profiles` table at all — every
-- role check in the app (`lib/auth/session.ts`, the sidebar, Settings, the
-- monitoring API routes' Admin/Manager gates) depends on it existing.
-- Additive, idempotent, safe to re-run.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'Staff' check (role in ('Admin', 'Manager', 'Staff', 'Viewer')),
  created_at timestamptz not null default now()
);

comment on table profiles is 'One row per app user, linked 1:1 to auth.users. Role drives every Admin/Manager gate in the app (lib/auth/session.ts).';

alter table profiles enable row level security;

-- Any authenticated user can read all profiles — matches the existing
-- pattern on websites/website_health_checks (open read, restricted write).
-- The Settings/"Team members" page needs this to list everyone; individual
-- pages need it to check their own role.
drop policy if exists "authenticated_read_profiles" on profiles;
create policy "authenticated_read_profiles" on profiles
  for select to authenticated using (true);

-- Only an Admin can update a profile (their own or someone else's) — the
-- Settings page updates role/email directly from the browser client, not
-- through a server route, so this has to be enforced here rather than only
-- in the UI. Insert/delete happen exclusively via the service-role client
-- in /api/admin/* routes (user creation and deletion), so no policy is
-- granted for those — matches the same reasoning as the websites table.
drop policy if exists "admin_update_profiles" on profiles;
create policy "admin_update_profiles" on profiles
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'Admin'));

-- ---------------------------------------------------------------------
-- FIRST-TIME SETUP (run once, manually, after applying this migration):
--
-- 1. Supabase dashboard -> Authentication -> Users -> Add user (email +
--    password). Copy the new user's UUID from that screen.
-- 2. Run this, with the UUID and email filled in, to make that first user
--    an Admin (every user after this one can be added from the app's own
--    Settings page instead):
--
--   insert into profiles (id, email, role)
--   values ('<paste-the-uuid-here>', '<their-email>', 'Admin');
-- ---------------------------------------------------------------------
