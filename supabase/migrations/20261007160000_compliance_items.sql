-- Register of things that expire: licences, insurance, certificates,
-- vehicle registrations, training and contract end dates. Entries come from
-- two places: typed in by an Admin, or suggested by Eleven after reading an
-- uploaded document. A suggestion does nothing until an Admin confirms it, so
-- a misread date can never raise (or hide) a real alert.
--
-- Filled and read only through server routes that check the user is an Admin
-- (service role), so RLS is on with no policy for logged-in users.

create table if not exists compliance_items (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid references knowledge_documents(id) on delete set null,
  title          text not null,
  kind           text not null default 'other',
  holder_type    text not null default 'company',
  holder_label   text,
  issued_date    date,
  expiry_date    date,
  status         text not null default 'suggested',
  source         text not null default 'manual',
  evidence       text,
  needs_check    boolean not null default false,
  notes          text,
  alerted_stage  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  confirmed_at   timestamptz,

  constraint compliance_items_status_check check (status in ('suggested', 'confirmed', 'dismissed')),
  constraint compliance_items_kind_check check (kind in ('licence', 'insurance', 'certificate', 'training', 'registration', 'contract', 'other')),
  constraint compliance_items_holder_check check (holder_type in ('person', 'vehicle', 'company'))
);

create index if not exists compliance_items_expiry_idx on compliance_items (expiry_date);
create index if not exists compliance_items_status_idx on compliance_items (status);
create index if not exists compliance_items_document_idx on compliance_items (document_id);

-- Remembers which documents have already been read for expiry dates, so a
-- scan only looks at new ones.
alter table knowledge_documents add column if not exists compliance_scanned_at timestamptz;

alter table compliance_items enable row level security;
