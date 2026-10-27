-- Letter Writer templates: the company's own letter wording, written and edited by staff in the Hub.
-- A template holds the subject, greeting, text and closing with {details} such as {name} and {startDate}
-- that are filled in from the staff record when a letter is written from it.
--
-- Read and written only through server routes that check the user's role (service role), so RLS is on
-- with no policy for logged-in users, like the letters tables.

create table if not exists letter_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text not null default 'hr',
  letter_type  text not null,
  subject      text not null default '',
  greeting     text not null default '',
  body         text not null default '',
  closing      text not null default '',
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint letter_templates_category_check check (category in ('hr', 'sales', 'quote', 'general')),
  constraint letter_templates_type_check check (letter_type in (
    'employment_confirmation', 'employment_reference', 'technician_introduction', 'work_assignment',
    'experience_confirmation', 'warning', 'general_business', 'custom'
  ))
);

create index if not exists letter_templates_category_idx on letter_templates (category, name);

alter table letter_templates enable row level security;
