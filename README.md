# KitchenRespray Dashboard — Module 1 Foundation

## What this is
A working dashboard foundation with:
- Login (Supabase auth)
- Sidebar navigation matching the client's module plan
- Placeholder pages for Claude Design and Company Knowledge (to be built next)
- "Coming Soon" placeholders for future modules (no fake functionality)

## Setup (after this is deployed on Vercel)
1. In Supabase: Settings -> API, copy the Project URL and anon public key.
2. In Vercel: Project Settings -> Environment Variables, add:
   - NEXT_PUBLIC_SUPABASE_URL
   - NEXT_PUBLIC_SUPABASE_ANON_KEY
   - ANTHROPIC_API_KEY (server-side only, used later for the Claude design workflow)
3. In Supabase: Authentication -> Users, manually add the first user (this becomes
   the first login for the dashboard).
4. Redeploy on Vercel after adding environment variables.

## Next steps (not built yet)
- Claude Design request form + Canva connection
- Company Knowledge data entry (brand voice, 7 service lines, Wrapping subcategories)
- Role-based permissions (Admin / Manager / Staff)

## Website Monitoring & Analytics module (Phase 1)

Central Website Command Centre for the ~60 company websites, at `/dashboard/monitoring`.
Phase 1 scope: multi-website data model + real HTTP/SSL health checks. Google
Analytics, Search Console, SEO, leads, WordPress, alerts, and Claude analysis
are separate later phases (each tab in a site's dashboard says so explicitly).

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full inspection findings,
what's built vs. deferred, which features need which credentials, and a real
baseline health check run against all 60 domains.

**Apply the schema** — in order, paste both of these into the Supabase SQL
Editor (or `supabase db push` after `supabase link`):
1. `supabase/migrations/20260919120000_monitoring_schema.sql` — the
   `websites` / `website_health_checks` tables plus two read-only views
   (`website_latest_check`, `website_uptime_7d`). Seeds an initial 4-site
   validation group.
2. `supabase/migrations/20260921120000_import_60_websites.sql` — imports the
   full 60-site master inventory (additive, `on conflict do nothing`, safe to
   re-run). **Read the note at the top of that file first** — it flags a
   domain spelling discrepancy that needs a human decision before go-live.
3. `supabase/migrations/20260921140000_priority_alerts_and_links.sql` — adds
   `likely_blocked` to health checks (WAF/bot-protection detection) and a
   new `website_link_checks` table for homepage broken-link scanning, both
   powering the new Priority Alerts panel.
4. `supabase/migrations/20260921150000_profiles.sql` — creates the
   `profiles` table (users + roles). This existed only as a hand-made table
   in the original Supabase project and was never captured in a migration —
   **a fresh Supabase project needs this one or nothing role-gated in the
   app works.** Includes first-admin setup instructions in a comment at the
   bottom of the file.

All four are additive only; nothing in the existing schema is touched.

**Verify domains before monitoring** — `node scripts/verify-websites.mjs`
runs a one-off, read-only HTTPS+SSL baseline check against all 60 real
domains (no Supabase credentials needed) and reports which ones don't
resolve, return errors, or look WordPress-powered. Re-run this after DNS/SSL
changes to any site.

**Run tests** — `npm test` runs the monitoring-logic unit tests
(domain normalization, status thresholds).

**New env vars** (see `.env.example`): `SUPABASE_SERVICE_ROLE_KEY`,
`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` were already required by existing
code but missing from this file — add them now if they aren't already set in
Vercel. `CRON_SECRET` is new, required for scheduled health checks.

**Scheduled checks** — `/api/monitoring/cron` only checks sites whose own
`monitoring_interval_minutes` has actually elapsed, in batches of 5, so it
never hammers client sites. Admin/Manager users can also trigger an immediate
check per site ("Run check now") or all sites at once ("Check all now" on
the Command Centre).

On **Vercel Hobby (free)**, native Cron Jobs are hard-capped to once/day —
declaring anything more frequent in `vercel.json` makes the *entire deploy
fail*, not just get throttled. `vercel.json` here declares a once-daily
cron (`0 6 * * *`) as a free fallback safety net, but the real monitoring
cadence comes from an **external scheduler** hitting the same endpoint —
e.g. [cron-job.org](https://cron-job.org) (free) calling
`POST https://<your-deployment>/api/monitoring/cron` with header
`Authorization: Bearer <CRON_SECRET>` every 30 minutes. This works
regardless of hosting plan since it's just a normal authenticated API call,
not Vercel's native Cron feature. Upgrading to Vercel Pro removes the
need for this — `vercel.json` can go back to `*/30 * * * *` at that point.

**Adding more sites** — no schema or code changes needed. Admin/Manager users
add a website from the Command Centre UI, or insert directly into the
`websites` table. Designed to scale to 100+ rows without redesign.

**Incidents & Slack notifications** — every check syncs an `incidents` row
(one per continuous critical/offline spell, not one per check — see
`lib/monitoring/incidents.ts`). Set `SLACK_WEBHOOK_URL` (Slack → Apps →
Incoming Webhooks → Add to Slack → pick a channel → copy the URL) to get
notified when an incident opens and when it resolves. Optional — checks
still run and incidents still get recorded without it, notifications are
just silently skipped.
