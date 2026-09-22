-- Claude Design / Canva / Company Knowledge schema.
--
-- None of this existed in the database at all — not "not connected", the
-- tables themselves were never created (same class of gap as the missing
-- `profiles` table found earlier). Reconstructed from every table/column
-- reference across app/api/generate-design, app/api/render-design,
-- app/api/canva/*, lib/canva/token.ts, and the two dashboard pages.

create table if not exists company_profile (
  id integer primary key,
  company_name text,
  description text,
  brand_voice text,
  brand_colours text,
  brand_fonts text,
  taglines text,
  language_rules text
);

comment on table company_profile is 'Singleton (always id=1) — the brand inputs the Knowledge page edits and generate-design/render-design read from.';

insert into company_profile (id)
values (1)
on conflict (id) do nothing;

create table if not exists service_lines (
  id serial primary key,
  name text not null unique,
  description text,
  target_customer text,
  key_benefits text,
  cta_guidance text,
  subcategories text
);

create table if not exists design_requests (
  id bigint generated always as identity primary key,
  service_line text not null,
  design_type text not null,
  platform text not null,
  brief text not null,
  additional_instructions text,
  status text not null default 'pending',
  photo_url text,
  photo_before_url text,
  photo_after_url text,
  generated_headline text,
  generated_caption text,
  generated_cta text,
  generated_post_type text,
  generated_design_notes text,
  generated_blocks jsonb,
  rendered_image_url text,
  canva_design_id text,
  canva_design_url text,
  canva_edit_url text,
  canva_thumbnail_url text,
  canva_download_url text,
  created_at timestamptz not null default now()
);

-- Server-only — holds live OAuth tokens. No policy for `authenticated` at
-- all, matches google_connections' reasoning: only the service-role
-- client (lib/canva/token.ts, every app/api/canva/* route) ever touches
-- this table.
create table if not exists canva_tokens (
  id uuid primary key default gen_random_uuid(),
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists canva_settings (
  id uuid primary key default gen_random_uuid(),
  generated_designs_folder_id text
);

create table if not exists canva_service_folders (
  id uuid primary key default gen_random_uuid(),
  service_line text not null unique,
  folder_id text not null
);

-- RLS. company_profile/service_lines: the Knowledge page already gates
-- itself to Admin/Manager client-side, but that's a UI gate, not
-- security — enforcing the same restriction in RLS here (matches the
-- profiles table's admin_update_profiles precedent) means it's real.
-- design_requests: any authenticated team member can submit/read/update —
-- the Claude Design page has no role gate, it's a general team tool.
-- canva_tokens/canva_settings/canva_service_folders: service-role only.

alter table company_profile enable row level security;
alter table service_lines enable row level security;
alter table design_requests enable row level security;
alter table canva_tokens enable row level security;
alter table canva_settings enable row level security;
alter table canva_service_folders enable row level security;

drop policy if exists "authenticated_read_company_profile" on company_profile;
create policy "authenticated_read_company_profile" on company_profile
  for select to authenticated using (true);

drop policy if exists "admin_manager_update_company_profile" on company_profile;
create policy "admin_manager_update_company_profile" on company_profile
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('Admin', 'Manager')));

drop policy if exists "authenticated_read_service_lines" on service_lines;
create policy "authenticated_read_service_lines" on service_lines
  for select to authenticated using (true);

drop policy if exists "admin_manager_update_service_lines" on service_lines;
create policy "admin_manager_update_service_lines" on service_lines
  for update to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('Admin', 'Manager')));

drop policy if exists "authenticated_all_design_requests" on design_requests;
create policy "authenticated_all_design_requests" on design_requests
  for all to authenticated using (true) with check (true);
