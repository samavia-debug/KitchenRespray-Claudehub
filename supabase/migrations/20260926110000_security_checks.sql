-- Security scan: detects a site hijack like the one found on
-- respraymykitchen.ie (hosting/DNS still legitimate, but the homepage was
-- serving an unrelated gambling site) — checks whether the homepage
-- redirects to a different domain and whether its content matches a
-- known spam/malware keyword list. Cheap (a single fetch, no paid API),
-- so unlike Core Web Vitals this runs on the automatic health-check
-- cadence, not manual-only — the whole point is catching a hijack without
-- someone having to remember to check.

create table if not exists website_security_checks (
  website_id uuid primary key references websites(id) on delete cascade,
  final_url text,
  domain_mismatch boolean not null default false,
  flagged_keywords text[] not null default '{}',
  risk_level text not null default 'none' check (risk_level in ('none', 'suspicious', 'critical')),
  error_message text,
  checked_at timestamptz not null default now()
);

comment on table website_security_checks is 'Latest security scan per site: does the homepage redirect to an unrelated domain, and does its content match known spam/gambling/malware keywords. One row per website, upserted on each check.';
comment on column website_security_checks.risk_level is 'none = clean, suspicious = flagged keywords found but same domain, critical = redirected to a different domain (the respraymykitchen.ie pattern) or both signals present.';

alter table website_security_checks enable row level security;

drop policy if exists "authenticated_read_security_checks" on website_security_checks;
create policy "authenticated_read_security_checks" on website_security_checks
  for select to authenticated using (true);
