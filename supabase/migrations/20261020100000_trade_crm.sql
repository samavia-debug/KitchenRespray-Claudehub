-- Trade Sales CRM (phase 2): companies, contacts, categories, pipeline stages, stage history and an audit trail.
--
-- These tables hold business contact details for commercial prospects. They are read and written only through
-- server routes that check the user's role (service role), so RLS is on with no policy for logged-in users.
-- The *_key columns are normalised copies (lower-case name, web domain, digits-only phone) used to warn about
-- duplicates before a record is created; they are derived by the server and never shown.
-- Safe to re-run.

-- Categories and stages are lists the Admin can rename or switch off in Settings, so they live in tables.
create table if not exists crm_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists crm_categories_name_unique on crm_categories (lower(name));

-- "kind" is what the code relies on, so a stage can be renamed without breaking "Won" or "Lost" handling.
create table if not exists crm_stages (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'open',
  -- Numeric so a new stage can slot in between two existing ones.
  sort_order  numeric(8, 2) not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint crm_stages_kind_check check (kind in ('open', 'won', 'lost', 'not_suitable'))
);
create unique index if not exists crm_stages_name_unique on crm_stages (lower(name));

insert into crm_categories (name, sort_order) values
  ('Hotels', 1),
  ('Facility Management', 2),
  ('Estate Agents', 3),
  ('Property Management', 4),
  ('Builders', 5),
  ('Carpenters and Joiners', 6),
  ('Kitchen Fitters', 7),
  ('Commercial Contractors', 8),
  ('Fit-Out Companies', 9),
  ('Other Commercial', 10)
on conflict do nothing;

insert into crm_stages (name, kind, sort_order) values
  ('New Prospect', 'open', 1),
  ('Ready to Contact', 'open', 2),
  ('Contacted', 'open', 3),
  ('Follow-up Required', 'open', 4),
  ('Interested', 'open', 5),
  ('Opportunity Identified', 'open', 6),
  ('Quote Requested', 'open', 7),
  ('Quote Sent', 'open', 8),
  ('Won', 'won', 9),
  ('Lost', 'lost', 10),
  ('Not Suitable', 'not_suitable', 11)
on conflict do nothing;

create table if not exists crm_companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  category_id         uuid references crm_categories(id) on delete set null,
  website             text,
  phone               text,
  email               text,
  address             text,
  city                text,
  county              text,
  postcode            text,
  country             text not null default 'Ireland',
  description         text,
  services            text,
  -- An estimate, never counted as revenue. What was actually won is won_value, set only when a deal is marked Won.
  estimated_value     numeric(12, 2),
  won_value           numeric(12, 2),
  outcome_note        text,
  source              text,
  priority            text not null default 'Medium',
  assigned_to         uuid references profiles(id) on delete set null,
  stage_id            uuid references crm_stages(id) on delete set null,
  stage_changed_at    timestamptz,
  last_contacted_at   timestamptz,
  next_follow_up      date,
  notes               text,
  -- Room for imported extras (rating, review count, unverified summaries) without a column per spreadsheet.
  extra               jsonb not null default '{}'::jsonb,
  name_key            text not null,
  website_domain      text,
  email_domain        text,
  phone_key           text,
  address_key         text,
  archived_at         timestamptz,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  constraint crm_companies_priority_check check (priority in ('High', 'Medium', 'Low')),
  constraint crm_companies_values_check check (
    (estimated_value is null or estimated_value >= 0) and (won_value is null or won_value >= 0)
  )
);

create index if not exists crm_companies_name_key_idx on crm_companies (name_key);
create index if not exists crm_companies_website_domain_idx on crm_companies (website_domain);
create index if not exists crm_companies_email_domain_idx on crm_companies (email_domain);
create index if not exists crm_companies_phone_key_idx on crm_companies (phone_key);
create index if not exists crm_companies_address_key_idx on crm_companies (address_key);
create index if not exists crm_companies_stage_idx on crm_companies (stage_id);
create index if not exists crm_companies_category_idx on crm_companies (category_id);
create index if not exists crm_companies_assigned_idx on crm_companies (assigned_to);
create index if not exists crm_companies_follow_up_idx on crm_companies (next_follow_up);
create index if not exists crm_companies_created_idx on crm_companies (created_at desc);

create table if not exists crm_contacts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references crm_companies(id) on delete cascade,
  full_name           text not null,
  name_key            text not null,
  job_title           text,
  email               text,
  email_key           text,
  phone               text,
  phone_key           text,
  preferred_method    text,
  source              text,
  notes               text,
  last_contacted_at   timestamptz,
  next_follow_up      date,
  assigned_to         uuid references profiles(id) on delete set null,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  constraint crm_contacts_method_check check (
    preferred_method is null or preferred_method in ('WhatsApp', 'Phone', 'Email', 'In person')
  )
);

create index if not exists crm_contacts_company_idx on crm_contacts (company_id);
create index if not exists crm_contacts_email_key_idx on crm_contacts (email_key);
create index if not exists crm_contacts_phone_key_idx on crm_contacts (phone_key);
create index if not exists crm_contacts_follow_up_idx on crm_contacts (next_follow_up);

-- Who moved a company between stages, when, and what was recorded for a win or loss.
create table if not exists crm_stage_history (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references crm_companies(id) on delete cascade,
  from_stage_id  uuid references crm_stages(id) on delete set null,
  to_stage_id    uuid references crm_stages(id) on delete set null,
  user_id        uuid,
  outcome_note   text,
  won_value      numeric(12, 2),
  created_at     timestamptz not null default now()
);

create index if not exists crm_stage_history_company_idx on crm_stage_history (company_id, created_at desc);

-- What happened and who did it. Holds names of fields that changed, never the contact details themselves.
create table if not exists crm_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists crm_events_entity_idx on crm_events (entity, entity_id, created_at desc);

alter table crm_categories enable row level security;
alter table crm_stages enable row level security;
alter table crm_companies enable row level security;
alter table crm_contacts enable row level security;
alter table crm_stage_history enable row level security;
alter table crm_events enable row level security;
