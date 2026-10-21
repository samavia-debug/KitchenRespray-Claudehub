-- Trade Sales CRM: specials. An offer the team is running in one Leinster county (or in all of them) between two dates:
-- what it is called, the exact wording to use, an optional code, and when it starts and ends. A county of NULL means the
-- special applies in every county. Staff see the specials running now; Admin and Manager set them up. Same access model
-- as the rest of the CRM: server routes only, RLS on with no policy for logged-in users. Each statement stands alone and
-- the script is safe to re-run.

create table if not exists crm_specials (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  offer       text not null,
  code        text,
  county      text,
  starts_on   date not null,
  ends_on     date,
  active      boolean not null default true,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint crm_specials_county_valid check (county is null or county in (
    'Carlow', 'Dublin', 'Kildare', 'Kilkenny', 'Laois', 'Longford', 'Louth',
    'Meath', 'Offaly', 'Westmeath', 'Wexford', 'Wicklow'
  )),
  constraint crm_specials_dates_valid check (ends_on is null or ends_on >= starts_on)
);

alter table crm_specials enable row level security;

create index if not exists crm_specials_dates_idx on crm_specials (starts_on, ends_on);
