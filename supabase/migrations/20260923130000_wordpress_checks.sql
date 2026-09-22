-- WordPress detection — passive, credential-free fingerprinting from the
-- public homepage source (generator meta tag, wp-content/wp-json
-- references, enqueued plugin asset version strings cross-checked against
-- the public WordPress.org Plugin API). No WP admin credentials used or
-- required. Real limits — not glossed over: a site that hides its
-- generator tag or rewrites asset version strings (common with security
-- and caching plugins) can produce an inaccurate or missing core version;
-- plugins with no front-end assets are invisible to this method; PHP
-- version and genuine plugin-failure detection need real server access
-- this technique cannot provide.

create table if not exists website_wordpress_checks (
  website_id uuid primary key references websites(id) on delete cascade,
  is_wordpress boolean not null default false,
  core_version text,
  theme_slug text,
  plugins jsonb not null default '[]'::jsonb,
  checked_at timestamptz not null default now()
);

comment on table website_wordpress_checks is 'Passive WordPress fingerprint per site (core version, theme, plugins with outdated-version flags where detectable). plugins is a JSON array of {slug, version, latestVersion, isOutdated}. One row per website, upserted on each manual check. Version values are read from public page source and are not guaranteed accurate — see lib/monitoring/wordpress.ts for why.';

alter table website_wordpress_checks enable row level security;

drop policy if exists "authenticated_read_wordpress_checks" on website_wordpress_checks;
create policy "authenticated_read_wordpress_checks" on website_wordpress_checks
  for select to authenticated using (true);
