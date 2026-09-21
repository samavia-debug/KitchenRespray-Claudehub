-- SEO technical checks + domain expiry tracking.
-- Additive only: one new table (latest-state, upserted like
-- website_link_checks) plus two columns on websites for domain expiry.

create table if not exists website_seo_checks (
  website_id uuid primary key references websites(id) on delete cascade,
  title text,
  meta_description text,
  canonical_url text,
  has_noindex boolean not null default false,
  robots_txt_status text not null check (robots_txt_status in ('found', 'missing', 'error')),
  robots_disallows_all boolean not null default false,
  sitemap_status text not null check (sitemap_status in ('found', 'missing', 'error')),
  sitemap_in_robots boolean not null default false,
  checked_at timestamptz not null default now()
);

comment on table website_seo_checks is 'Latest technical SEO snapshot per site (title, meta description, canonical, noindex, robots.txt, sitemap.xml). One row per website, upserted on each check — not a full crawl, just the homepage + the two well-known files.';

alter table website_seo_checks enable row level security;

drop policy if exists "authenticated_read_seo_checks" on website_seo_checks;
create policy "authenticated_read_seo_checks" on website_seo_checks
  for select to authenticated using (true);

-- Domain expiry lives on websites itself (1:1, not a growing history like
-- health checks) — looked up via RDAP, which most registries support for
-- free with no API key, but not all ccTLDs do, hence the nullable
-- "not available" case being a real, expected outcome, not an error state.
alter table websites
  add column if not exists domain_expires_at timestamptz,
  add column if not exists domain_expiry_checked_at timestamptz,
  add column if not exists domain_expiry_unavailable boolean not null default false;

comment on column websites.domain_expiry_unavailable is 'True when RDAP lookup succeeded but returned no expiry data, or the registry does not support RDAP for this TLD — distinct from "not checked yet" (domain_expiry_checked_at is null) and from a real lookup failure.';
