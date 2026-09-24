-- Per-site Claude analysis — one row per website (upsert, not a history
-- log), matching the same "latest snapshot" pattern as seo_checks,
-- wordpress_checks and core_web_vitals_checks. Manually triggered, same
-- reasoning as Core Web Vitals: a real analysis call costs money and
-- takes a few seconds, so it isn't run on the automatic monitoring
-- schedule.

create table if not exists claude_analyses (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references websites(id) on delete cascade unique,
  analysis text not null,
  model text not null,
  created_at timestamptz not null default now()
);

alter table claude_analyses enable row level security;

drop policy if exists "authenticated_read_claude_analyses" on claude_analyses;
create policy "authenticated_read_claude_analyses" on claude_analyses
  for select to authenticated using (true);
