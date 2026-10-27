-- Fleet: the company's vans, what each is worth and what is still owed on it, who has it, and when its
-- tax, DOE and insurance are due. Replaces the "New Van List" spreadsheet.
--
-- Holds finance figures, so it is read and written only through server routes that check the user is an
-- Admin (service role): RLS is on with no policy for logged-in users, like the letters tables.
--
-- The *_alerted_stage columns record which expiry warning (30, 14, 7 days, expired) has already been sent
-- for each date, the same way the compliance register does, so each warning goes out once.

create table if not exists fleet_vans (
  id                       uuid primary key default gen_random_uuid(),
  reg                      text not null,
  reg_key                  text not null unique,
  model                    text,
  driver                   text,
  lender                   text,
  agreement                text,
  value_eur                numeric(12, 2),
  monthly_eur              numeric(12, 2),
  settlement_eur           numeric(12, 2),
  weight_kg                integer,
  tax_pin                  text,
  tax_due                  date,
  doe_due                  date,
  insurance_due            date,
  tax_alerted_stage        smallint not null default 0,
  doe_alerted_stage        smallint not null default 0,
  insurance_alerted_stage  smallint not null default 0,
  status                   text not null default 'active',
  notes                    text,
  created_by               uuid,
  updated_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint fleet_vans_status_check check (status in ('active', 'gone'))
);

create index if not exists fleet_vans_status_idx on fleet_vans (status, reg);

alter table fleet_vans enable row level security;
