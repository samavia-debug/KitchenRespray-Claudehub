-- Core Web Vitals (PageSpeed Insights, mobile strategy) — latest-state per
-- site, same upsert pattern as website_seo_checks. Manually triggered, not
-- on the frequent health-check cadence: a real Lighthouse audit takes
-- 10-30+ seconds per site and PageSpeed Insights' unauthenticated quota is
-- easily exhausted — confirmed empirically while building this (see
-- ARCHITECTURE.md) — so running it for 26 sites every 30 minutes would be
-- both slow and likely to fail on quota alone.

create table if not exists core_web_vitals_checks (
  website_id uuid primary key references websites(id) on delete cascade,
  performance_score integer,
  lcp_ms numeric,
  cls numeric,
  tbt_ms numeric,
  has_field_data boolean not null default false,
  checked_at timestamptz not null default now()
);

comment on table core_web_vitals_checks is 'Latest PageSpeed Insights (mobile) result per site: performance score (0-100), LCP, CLS, TBT (lab proxy for INP — real INP needs field data most sites lack enough traffic to report, see has_field_data). One row per website, upserted on each manual check.';

alter table core_web_vitals_checks enable row level security;

drop policy if exists "authenticated_read_core_web_vitals" on core_web_vitals_checks;
create policy "authenticated_read_core_web_vitals" on core_web_vitals_checks
  for select to authenticated using (true);
