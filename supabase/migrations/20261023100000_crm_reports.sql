-- Trade Sales CRM (phase 5): overview and reports. Reports have to answer "how many quotes were sent this month",
-- and an opportunity that was sent a quote and then won no longer shows as "quote sent", so each opportunity's
-- status changes are kept as they happen. Same access model as before: server routes only, RLS on with no policy
-- for logged-in users. Safe to re-run.

create table if not exists crm_opportunity_history (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references crm_opportunities(id) on delete cascade,
  from_status     text,
  to_status       text not null,
  user_id         uuid,
  created_at      timestamptz not null default now(),
  constraint crm_opportunity_history_status_check check (to_status in ('identified', 'quote_requested', 'quote_sent', 'won', 'lost'))
);

create index if not exists crm_opportunity_history_opp_idx on crm_opportunity_history (opportunity_id, created_at);
create index if not exists crm_opportunity_history_status_idx on crm_opportunity_history (to_status, created_at);

-- Opportunities that already exist get a starting history: when they were identified and, if they have moved on,
-- when they reached their current status. (Only the current status is known, so any step skipped in between
-- is not invented.)
insert into crm_opportunity_history (opportunity_id, from_status, to_status, created_at)
select o.id, null, 'identified', o.created_at
from crm_opportunities o
where not exists (select 1 from crm_opportunity_history h where h.opportunity_id = o.id);

insert into crm_opportunity_history (opportunity_id, from_status, to_status, created_at)
select o.id, 'identified', o.status, o.status_changed_at
from crm_opportunities o
where o.status <> 'identified'
  and not exists (select 1 from crm_opportunity_history h where h.opportunity_id = o.id and h.to_status = o.status);

-- Reports look up work by date, so the dated columns they filter on get indexes.
create index if not exists crm_activities_occurred_idx on crm_activities (occurred_at);
create index if not exists crm_tasks_completed_at_idx on crm_tasks (completed_at) where status = 'done';
create index if not exists crm_stage_history_created_idx on crm_stage_history (created_at);

alter table crm_opportunity_history enable row level security;
