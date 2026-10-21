-- Trade Sales CRM: documents and quotes attached to a company (and, if wanted, to one of its opportunities). The files
-- live in a PRIVATE Storage bucket, "crm-documents": nobody gets a public link, and the server hands out a short-lived
-- download link only after checking who is asking. The bucket itself also refuses anything over 10 MB or of a type that
-- is not a PDF, picture, Word or Excel file. This table holds what the file is called, who added it and when. Same access
-- model as the rest of the CRM: server routes only, RLS on with no policy for logged-in users. Each statement stands
-- alone and the script is safe to re-run.

create table if not exists crm_documents (
  id              uuid primary key,
  company_id      uuid not null references crm_companies(id) on delete cascade,
  opportunity_id  uuid references crm_opportunities(id) on delete set null,
  file_name       text not null,
  storage_path    text not null unique,
  size_bytes      bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  content_type    text not null,
  note            text,
  uploaded_by     uuid,
  created_at      timestamptz not null default now()
);

alter table crm_documents enable row level security;

create index if not exists crm_documents_company_idx on crm_documents (company_id, created_at desc);

create index if not exists crm_documents_opportunity_idx on crm_documents (opportunity_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'crm-documents',
  'crm-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
