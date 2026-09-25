-- Knowledge Base — a general-purpose store of company/business knowledge
-- (free-form documents, FAQ/Q&A, pricing & service details) that Claude
-- draws on as context, distinct from company_profile/service_lines (which
-- are narrowly scoped brand-voice inputs feeding only Claude Design).
--
-- Single company-wide table rather than a per-site schema: website_id is
-- nullable — null means the entry applies to every site, a set value scopes
-- it to that one site/brand specifically. This matches the "company-wide
-- with optional per-site overrides" scope the team asked for without
-- needing a separate per-site data model.

create table if not exists knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  website_id uuid references websites(id) on delete cascade,
  entry_type text not null default 'document' check (entry_type in ('document', 'faq', 'pricing')),
  title text not null,
  content text not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column knowledge_entries.website_id is 'Null = applies company-wide. Set = scoped to that one site/brand only.';
comment on column knowledge_entries.content is 'For entry_type=faq, title holds the question and content holds the answer.';

create index if not exists knowledge_entries_website_id_idx on knowledge_entries(website_id);

alter table knowledge_entries enable row level security;

-- Same split as company_profile/service_lines: any authenticated team
-- member can read (Claude-facing API routes use the service-role client
-- anyway, this covers the dashboard UI), only Admin/Manager can write.
drop policy if exists "authenticated_read_knowledge_entries" on knowledge_entries;
create policy "authenticated_read_knowledge_entries" on knowledge_entries
  for select to authenticated using (true);

drop policy if exists "admin_manager_write_knowledge_entries" on knowledge_entries;
create policy "admin_manager_write_knowledge_entries" on knowledge_entries
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('Admin', 'Manager')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('Admin', 'Manager')));
