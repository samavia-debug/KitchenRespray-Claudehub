-- Google Analytics / Search Console connection architecture.
--
-- Schema + OAuth plumbing only in this pass — no live Client ID/Secret
-- exists yet to test an actual token exchange against, and no metrics-sync
-- job exists yet to populate analytics_metrics/search_console_metrics.
-- Both tables are created now so the shape is settled and reviewable
-- ahead of that follow-up work, matching how every other credential-gated
-- integration in this app was built (schema + UI first, wired for real
-- once the credential shows up).

create table if not exists google_connections (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete cascade,
  service text not null check (service in ('analytics', 'search_console')),
  external_account_email text,
  property_id text,
  site_url text,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  connected_by uuid references profiles(id) on delete set null,
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  unique (website_id, service)
);

comment on table google_connections is 'One row per (website, GA4-or-Search-Console) OAuth connection. Tokens are server-only by design: RLS below grants no policy to `authenticated` at all, so even an Admin browsing the app cannot read a raw token — every read/write goes through the service-role client in an API route. A stronger option (application-layer encryption via Supabase Vault, pgsodium) is a documented future hardening step, not implemented here — this table is not yet holding anything live to protect.';

alter table google_connections enable row level security;
-- Deliberately no policies for `authenticated` — service-role only.

create index if not exists idx_google_connections_website
  on google_connections (website_id);

-- Daily GA4 metrics per site. Empty until a sync job (later work) actually
-- calls the GA4 Data API using a connection above.
create table if not exists analytics_metrics (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete cascade,
  date date not null,
  users integer,
  sessions integer,
  conversions integer,
  synced_at timestamptz not null default now(),
  unique (website_id, date)
);

alter table analytics_metrics enable row level security;

drop policy if exists "authenticated_read_analytics_metrics" on analytics_metrics;
create policy "authenticated_read_analytics_metrics" on analytics_metrics
  for select to authenticated using (true);

-- Daily Search Console metrics per site. Same "empty until a sync job
-- exists" note as analytics_metrics.
create table if not exists search_console_metrics (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete cascade,
  date date not null,
  clicks integer,
  impressions integer,
  ctr numeric,
  avg_position numeric,
  synced_at timestamptz not null default now(),
  unique (website_id, date)
);

alter table search_console_metrics enable row level security;

drop policy if exists "authenticated_read_search_console_metrics" on search_console_metrics;
create policy "authenticated_read_search_console_metrics" on search_console_metrics
  for select to authenticated using (true);
