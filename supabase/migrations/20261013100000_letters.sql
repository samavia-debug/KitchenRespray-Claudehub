-- Letter Writer: saved letters, letterhead / signatory settings and an audit
-- trail. Technician details are NOT copied into a second technician table: a
-- letter keeps a snapshot of the facts it was written from (so a later change
-- in Connecteam never silently rewrites an issued letter), and the technician
-- list itself is still read from the existing Connecteam staff entries.
--
-- Letters hold confidential employment correspondence. They are read and
-- written only through server routes that check the user is an Admin (service
-- role), so RLS is on with no policy for logged-in users.

create table if not exists letter_settings (
  id               integer primary key default 1,
  company_name     text,
  address          text,
  phone            text,
  email            text,
  website          text,
  signatory_name   text,
  signatory_title  text,
  footer_text      text,
  updated_at       timestamptz not null default now(),
  constraint letter_settings_single_row check (id = 1)
);

create table if not exists letters (
  id                  uuid primary key default gen_random_uuid(),
  technician_user_id  bigint,
  technician_name     text not null,
  technician_former   boolean not null default false,
  letter_type         text not null,
  status              text not null default 'draft',
  subject             text not null default '',
  letter_date         date not null default current_date,
  recipient           jsonb not null default '{}'::jsonb,
  facts               jsonb not null default '{}'::jsonb,
  details             jsonb not null default '{}'::jsonb,
  greeting            text not null default '',
  body                text not null default '',
  closing             text not null default '',
  missing             jsonb not null default '[]'::jsonb,
  ai_generated        boolean not null default false,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  finalised_by        uuid,
  finalised_at        timestamptz,
  approved_by         uuid,
  approved_at         timestamptz,

  constraint letters_status_check check (status in ('draft', 'finalised', 'approved')),
  constraint letters_type_check check (letter_type in (
    'employment_confirmation', 'employment_reference', 'technician_introduction', 'work_assignment',
    'experience_confirmation', 'warning', 'general_business', 'custom'
  ))
);

create index if not exists letters_updated_idx on letters (updated_at desc);
create index if not exists letters_technician_idx on letters (technician_user_id);
create index if not exists letters_status_idx on letters (status);

-- What happened and who did it, never what the letter said.
create table if not exists letter_events (
  id          uuid primary key default gen_random_uuid(),
  letter_id   uuid references letters(id) on delete cascade,
  user_id     uuid,
  action      text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists letter_events_letter_idx on letter_events (letter_id, created_at desc);

alter table letter_settings enable row level security;
alter table letters enable row level security;
alter table letter_events enable row level security;
