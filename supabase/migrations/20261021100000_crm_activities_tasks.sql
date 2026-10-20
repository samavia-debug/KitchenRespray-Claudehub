-- Trade Sales CRM (phase 3): activities (what was done), follow-up tasks (what to do next) and opportunities
-- (separate potential jobs at a company). Same access model as phase 2: read and written only through server
-- routes that check the user's role, so RLS is on with no policy for logged-in users.
-- Safe to re-run.

-- The most recent activity is kept on the company so the follow-up list can show it without searching the history.
alter table crm_companies add column if not exists last_activity_type text;
alter table crm_companies add column if not exists last_activity_at timestamptz;

-- Something a person did and recorded: a call, an email, a visit. Nothing here is ever created automatically.
create table if not exists crm_activities (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references crm_companies(id) on delete cascade,
  contact_id    uuid references crm_contacts(id) on delete set null,
  type          text not null,
  occurred_at   timestamptz not null default now(),
  -- The staff member who did it, which is not always the person who typed it in.
  user_id       uuid references profiles(id) on delete set null,
  outcome       text,
  notes         text,
  next_action   text,
  next_follow_up date,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  constraint crm_activities_type_check check (type in (
    'Initial research', 'Telephone call', 'Email sent', 'Promotional material sent', 'Follow-up email',
    'Follow-up call', 'Meeting', 'Site visit', 'Quote requested', 'Quote sent', 'Other'
  ))
);

create index if not exists crm_activities_company_idx on crm_activities (company_id, occurred_at desc);
create index if not exists crm_activities_user_idx on crm_activities (user_id, occurred_at desc);
create index if not exists crm_activities_type_idx on crm_activities (type);

-- A follow-up. A company's "next follow-up" date is the earliest open task, kept up to date by the server.
create table if not exists crm_tasks (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references crm_companies(id) on delete cascade,
  contact_id          uuid references crm_contacts(id) on delete set null,
  title               text not null,
  due_date            date not null,
  assigned_to         uuid references profiles(id) on delete set null,
  status              text not null default 'open',
  completed_at        timestamptz,
  completed_by        uuid,
  result              text,
  source_activity_id  uuid references crm_activities(id) on delete set null,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_by          uuid,
  updated_at          timestamptz not null default now(),
  constraint crm_tasks_status_check check (status in ('open', 'done', 'cancelled'))
);

create index if not exists crm_tasks_company_idx on crm_tasks (company_id, status);
create index if not exists crm_tasks_open_due_idx on crm_tasks (status, due_date);
create index if not exists crm_tasks_assigned_idx on crm_tasks (assigned_to, status, due_date);
create index if not exists crm_tasks_completed_idx on crm_tasks (completed_at desc) where status = 'done';

-- A potential job at a company. A company can have several. "estimated_value" is a guess and never counted as
-- sales; "won_value" is set only when it is marked won. "source" is recorded so a sale is only credited to
-- direct prospecting when somebody has said so.
create table if not exists crm_opportunities (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references crm_companies(id) on delete cascade,
  title              text not null,
  description        text,
  status             text not null default 'identified',
  status_changed_at  timestamptz not null default now(),
  estimated_value    numeric(12, 2),
  won_value          numeric(12, 2),
  outcome_note       text,
  source             text,
  assigned_to        uuid references profiles(id) on delete set null,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_by         uuid,
  updated_at         timestamptz not null default now(),
  constraint crm_opportunities_status_check check (status in ('identified', 'quote_requested', 'quote_sent', 'won', 'lost')),
  constraint crm_opportunities_source_check check (
    source is null or source in ('Direct prospecting', 'Website enquiry', 'Referral', 'Existing customer', 'Other')
  ),
  constraint crm_opportunities_values_check check (
    (estimated_value is null or estimated_value >= 0) and (won_value is null or won_value >= 0)
  )
);

create index if not exists crm_opportunities_company_idx on crm_opportunities (company_id);
create index if not exists crm_opportunities_status_idx on crm_opportunities (status);

alter table crm_activities enable row level security;
alter table crm_tasks enable row level security;
alter table crm_opportunities enable row level security;
