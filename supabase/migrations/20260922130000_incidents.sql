-- Persisted incidents + smart alert dedup.
--
-- Right now the Priority Alerts panel re-derives "what's wrong" from only
-- the latest health check, every time it renders. That means: no memory of
-- how long a site has been down, and no dedup — the same problem reads as
-- a fresh alert on every page load instead of "still down, 40 minutes and
-- counting". This table is the fix: one row per continuous bad spell,
-- opened on the first critical/offline check, updated (not duplicated) on
-- every subsequent check that's still bad, and closed on the first check
-- that recovers.

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete cascade,
  severity text not null check (severity in ('critical', 'offline')),
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  resolved_at timestamptz,
  detection_count integer not null default 1,
  created_at timestamptz not null default now()
);

comment on table incidents is 'One row per continuous critical/offline spell for a website. Opened on the first bad check, updated (last_seen_at, detection_count) on every subsequent bad check instead of creating a duplicate, closed (resolved_at set) on the first check that recovers. Never more than one open row per website — enforced by the partial unique index below.';

-- At most one OPEN incident per website at a time — this is what makes
-- "continue vs. open a new one" unambiguous.
create unique index if not exists idx_incidents_one_open_per_website
  on incidents (website_id)
  where resolved_at is null;

create index if not exists idx_incidents_website_started
  on incidents (website_id, started_at desc);

alter table incidents enable row level security;

drop policy if exists "authenticated_read_incidents" on incidents;
create policy "authenticated_read_incidents" on incidents
  for select to authenticated using (true);
