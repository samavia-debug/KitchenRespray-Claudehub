-- Priority alerts + broken-link/blockage monitoring.
-- Additive only: one new column on the existing health-check table, one new
-- append/upsert table for link checks, and two read-only views. Nothing
-- existing is touched or renamed.

-- A 403 (or similar) to the monitor's own request is a distinct finding from
-- a generic 4xx: it commonly means a WAF/bot-protection rule (Cloudflare,
-- Sucuri, etc.) is blocking the *monitor*, not that real visitors are
-- blocked. Tracked as its own signal so alerts/recommendations can say so
-- explicitly instead of lumping it in with "site is broken".
alter table website_health_checks
  add column if not exists likely_blocked boolean not null default false;

comment on column website_health_checks.likely_blocked is
  'True when the response looks like a WAF/bot-protection block (e.g. 403 with a Cloudflare/Sucuri signature) rather than a genuine site error. Surfaced separately so alerts do not conflate "blocked from monitoring" with "broken for visitors".';

-- One row per link found on a monitored site's homepage, upserted on every
-- link-check run (not append-only like health_checks — we want "is this
-- link still broken right now", with first_detected_at preserved across
-- runs so an incident's age is visible).
create table if not exists website_link_checks (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete cascade,
  source_url text not null,
  target_url text not null,
  link_type text not null check (link_type in ('internal', 'external')),
  http_status integer,
  is_broken boolean not null,
  error_message text,
  first_detected_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  unique (website_id, target_url)
);

comment on table website_link_checks is 'Latest known state of every link found on a monitored site''s homepage. Upserted per check run; first_detected_at is preserved so a broken link''s age is visible.';

create index if not exists idx_link_checks_website
  on website_link_checks (website_id);

create index if not exists idx_link_checks_broken
  on website_link_checks (website_id) where is_broken;

-- Convenience view: open (currently broken) link count per website.
create or replace view website_broken_links_count as
select
  website_id,
  count(*) filter (where is_broken) as broken_count,
  count(*) as checked_count
from website_link_checks
group by website_id;

alter table website_link_checks enable row level security;

drop policy if exists "authenticated_read_link_checks" on website_link_checks;
create policy "authenticated_read_link_checks" on website_link_checks
  for select to authenticated using (true);
