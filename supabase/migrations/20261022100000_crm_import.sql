-- Trade Sales CRM (phase 4): spreadsheet import. Every import is recorded as a batch, and the companies and
-- contacts it creates point back at it, so an import that went wrong can be undone (only for records nobody has
-- touched since). Companies also get a mobile number, kept separate from the main phone, as the lead lists have both.
-- Same access model as before: server routes only, RLS on with no policy for logged-in users. Safe to re-run.

create table if not exists crm_import_batches (
  id               uuid primary key default gen_random_uuid(),
  filename         text,
  row_count        integer not null default 0,
  imported_count   integer not null default 0,
  skipped_count    integer not null default 0,
  failed_count     integer not null default 0,
  contact_count    integer not null default 0,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  undone_at        timestamptz,
  undone_by        uuid
);

create index if not exists crm_import_batches_created_idx on crm_import_batches (created_at desc);

alter table crm_companies add column if not exists import_batch_id uuid references crm_import_batches(id) on delete set null;
alter table crm_contacts add column if not exists import_batch_id uuid references crm_import_batches(id) on delete set null;
create index if not exists crm_companies_batch_idx on crm_companies (import_batch_id);
create index if not exists crm_contacts_batch_idx on crm_contacts (import_batch_id);

-- A mobile (WhatsApp) number apart from the main phone. mobile_key is the digits-only copy used for duplicate checks.
alter table crm_companies add column if not exists mobile text;
alter table crm_companies add column if not exists mobile_key text;
create index if not exists crm_companies_mobile_key_idx on crm_companies (mobile_key);

alter table crm_import_batches enable row level security;
