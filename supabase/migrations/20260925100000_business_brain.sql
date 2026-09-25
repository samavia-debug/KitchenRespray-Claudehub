-- Evolves knowledge_entries (built 2026-09-25) into the "Business Brain":
-- a widened set of knowledge types plus the generic fields (tags, status,
-- owner, source, review date) needed for company facts, brands, services,
-- people, processes, SOPs, decisions, policies, training, clients,
-- projects, marketing and technical knowledge — not just documents/FAQs.
--
-- Purely additive: existing rows (entry_type document/faq/pricing) stay
-- valid as-is, no data moves or is deleted. New columns are all nullable
-- or defaulted, so every existing row is immediately valid under the new
-- schema with zero backfill needed.

alter table knowledge_entries drop constraint if exists knowledge_entries_entry_type_check;
alter table knowledge_entries add constraint knowledge_entries_entry_type_check
  check (entry_type in (
    'document', 'faq', 'pricing',
    'company_fact', 'brand', 'service', 'person', 'process', 'sop',
    'decision', 'policy', 'training', 'client', 'project', 'marketing',
    'technical', 'other'
  ));

alter table knowledge_entries add column if not exists tags text[] not null default '{}';
alter table knowledge_entries add column if not exists status text not null default 'verified'
  check (status in ('draft', 'review', 'verified', 'outdated', 'archived'));
alter table knowledge_entries add column if not exists owner_name text;
alter table knowledge_entries add column if not exists source text;
alter table knowledge_entries add column if not exists review_date date;

comment on column knowledge_entries.status is 'draft/review/verified/outdated/archived — surfaced on the Knowledge Health tab.';
comment on column knowledge_entries.review_date is 'When this entry should next be reviewed; null = no review scheduled. Overdue entries surface on Knowledge Health.';

create index if not exists knowledge_entries_entry_type_idx on knowledge_entries(entry_type);

-- Document uploads (title/file metadata) are kept separate from
-- knowledge_entries (free-form searchable text) because they have
-- different shapes — a document is a file plus bookkeeping fields, not a
-- title+content pair. Files themselves live in Supabase Storage bucket
-- "business-brain-documents" (create manually in the Supabase dashboard,
-- same as request-photos/design-previews/design-exports were — no
-- migration creates storage buckets in this project).
create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  website_id uuid references websites(id) on delete cascade,
  title text not null,
  category text,
  description text,
  file_path text not null,
  file_type text,
  uploaded_by uuid references profiles(id) on delete set null,
  status text not null default 'review' check (status in ('draft', 'review', 'verified', 'outdated', 'archived')),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_documents_website_id_idx on knowledge_documents(website_id);

alter table knowledge_documents enable row level security;

drop policy if exists "authenticated_read_knowledge_documents" on knowledge_documents;
create policy "authenticated_read_knowledge_documents" on knowledge_documents
  for select to authenticated using (true);

drop policy if exists "admin_manager_write_knowledge_documents" on knowledge_documents;
create policy "admin_manager_write_knowledge_documents" on knowledge_documents
  for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('Admin', 'Manager')))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('Admin', 'Manager')));
