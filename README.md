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

Central Website Command Centre for the ~40 company websites, at `/dashboard/monitoring`.
Phase 1 scope: multi-website data model + real HTTP/SSL health checks. Google
Analytics, Search Console, SEO, leads, WordPress, alerts, and Claude analysis
are separate later phases (each tab in a site's dashboard says so explicitly).

**Apply the schema** — paste `supabase/migrations/20260919120000_monitoring_schema.sql`
into the Supabase SQL Editor (or `supabase db push` after `supabase link`).
It's additive only: new `websites` / `website_health_checks` tables plus two
read-only views (`website_latest_check`, `website_uptime_7d`). Nothing in the
existing schema is touched. It also seeds the initial 4-site test group
(kitchenrespray.com, allsurfacerespray.com, kitchenfacelift.ie,
tradesprayireland.com) — validate against these before adding the rest.

**New env vars** (see `.env.example`): `SUPABASE_SERVICE_ROLE_KEY`,
`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET` were already required by existing
code but missing from this file — add them now if they aren't already set in
Vercel. `CRON_SECRET` is new, required for scheduled health checks.

**Scheduled checks** — `vercel.json` registers a cron hitting
`/api/monitoring/cron` every 30 minutes. It only checks sites whose own
`monitoring_interval_minutes` has actually elapsed, in batches of 5, so it
never hammers client sites. Admin/Manager users can also trigger an immediate
check per site from that site's dashboard ("Run check now").

**Adding more sites** — no schema or code changes needed. Admin/Manager users
add a website from the Command Centre UI, or insert directly into the
`websites` table. Designed to scale to 100+ rows without redesign.
