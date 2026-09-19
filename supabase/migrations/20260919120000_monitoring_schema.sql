-- Website Monitoring & Analytics module — Phase 1
-- Adds the multi-website data model. Nothing here touches existing tables
-- (profiles, company_profile, service_lines, design_requests, canva_*).
--
-- Apply via: `supabase db push` (after `supabase link`) or by pasting this
-- file into the Supabase project's SQL Editor. Safe to re-run (idempotent).

create extension if not exists "pgcrypto";

-- One row per monitored website. New sites are added here as rows, not by
-- changing the schema — this table is designed to scale from 4 to 100+ sites.
create table if not exists websites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text not null unique,
  category text,
  priority text not null default 'medium'
    check (priority in ('critical', 'high', 'medium', 'low')),
  monitoring_interval_minutes integer not null default 30
    check (monitoring_interval_minutes >= 5),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table websites is 'Every website tracked by the Website Command Centre. One row per site.';
comment on column websites.monitoring_interval_minutes is 'How often the cron checker should probe this site. Configurable per site to avoid overloading small client sites.';

-- One row per health probe. Append-only history — this is what powers
-- uptime %, performance trends, and SSL/domain expiry alerts.
create table if not exists website_health_checks (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete cascade,
  checked_at timestamptz not null default now(),
  is_up boolean not null,
  http_status integer,
  response_time_ms integer,
  ssl_valid boolean,
  ssl_expires_at timestamptz,
  error_message text
);

comment on table website_health_checks is 'Append-only history of HTTP/SSL health probes, one row per check per site.';

create index if not exists idx_health_checks_website_time
  on website_health_checks (website_id, checked_at desc);

-- Convenience view: the single most recent check per website.
create or replace view website_latest_check as
select distinct on (website_id) *
from website_health_checks
order by website_id, checked_at desc;

-- Convenience view: uptime % over the trailing 7 days per website.
create or replace view website_uptime_7d as
select
  website_id,
  round(100.0 * sum(case when is_up then 1 else 0 end) / count(*), 1) as uptime_percent,
  count(*) as checks_count
from website_health_checks
where checked_at > now() - interval '7 days'
group by website_id;

-- RLS: any authenticated staff member can read monitoring data (matches the
-- rest of the app, where authorization is enforced in API routes / pages,
-- not per-row policies). Writes have no policy for anon/authenticated, so
-- they only happen via the service-role client inside API routes —
-- mirroring how canva_tokens / profiles admin writes already work.
alter table websites enable row level security;
alter table website_health_checks enable row level security;

drop policy if exists "authenticated_read_websites" on websites;
create policy "authenticated_read_websites" on websites
  for select to authenticated using (true);

drop policy if exists "authenticated_read_health_checks" on website_health_checks;
create policy "authenticated_read_health_checks" on website_health_checks
  for select to authenticated using (true);

-- Seed the initial 4-site test group (per the phased rollout — validate
-- against a handful of real sites before onboarding the rest of the ~40).
insert into websites (name, domain, category, priority)
values
  ('Kitchen Respray', 'kitchenrespray.com', 'Kitchen Respray Services', 'high'),
  ('All Surface Respray', 'allsurfacerespray.com', 'Surface Respray Services', 'high'),
  ('Kitchen Facelift', 'kitchenfacelift.ie', 'Kitchen Respray Services', 'high'),
  ('Trade Spray Ireland', 'tradesprayireland.com', 'Trade / B2B Respray Services', 'high')
on conflict (domain) do nothing;
