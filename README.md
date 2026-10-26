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

## Passwords
- **Anyone signed in** can change their own password from **My account** (top bar). They give the current password too, so a computer left open cannot be used to lock the owner out.
- **Forgot password?** on the sign-in page emails a one-time link (`/auth/callback` swaps the code for a sign-in, then `/reset-password`). The link has to be opened in the same browser it was requested from. It needs Supabase's **Authentication → URL Configuration → Redirect URLs** to include `https://<the site>/auth/callback`.
- **Admins** (Settings) can set a team member's password to one they type, or make a temporary one that is shown once, and can choose the first password when adding someone. An Admin changes their own from My account.
- Passwords are 8 to 72 characters and refuse the obvious (one repeated character, well-known ones, the person's own email). Temporary passwords come from the system's secure random source. The rules are in `lib/auth/password-policy.ts`.

## Letter Writer
- **Admin only.** Choose a technician and a kind of letter; **Write the letter for me** builds the whole letter at once from ready-made paragraphs (`lib/letters/stock.ts`) and the details already on record, with no AI call. The AI service is still there as a second button.
- **The address block fills itself in.** For a letter to the person (work assignment, warning) it is addressed to them with their home address, phone and email; for any other type, one button does the same. The home address is read live from Connecteam, from the custom field named like "Home address" (`lib/letters/staff-address.ts`); it is not copied into the Hub with the staff record, and it is never sent to the AI service. It is kept only on a letter that is saved. If Connecteam has none, the field is left for typing.
- **Ready-made paragraphs** exist for each letter type, plus a few general ones (thank you, please contact us, quote a reference). Tokens like `{name}`, `{jobTitle}` and `{startDate}` are filled from the record; anything unknown becomes `[CONFIRM: ...]`, which stops the letter being finalised. While editing, **Add a ready-made paragraph** appends any of them.

## Next steps (not built yet)
- Claude Design request form + Canva connection
- Company Knowledge data entry (brand voice, 7 service lines, Wrapping subcategories)
- Role-based permissions (Admin / Manager / Staff)

## Website Monitoring & Analytics module (Phase 1)

Central Website Command Centre for the company's 26 monitored websites, at
`/dashboard/monitoring` (narrowed down from an initial 61-site inventory —
see `supabase/migrations/20260922150000_descope_to_26_sites.sql`).
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

The scheduler gives up on a request after 30 seconds, so the work is split
across three endpoints, each keeping itself to about 24 seconds and picking up
where it left off on the next call. All use the same `Authorization: Bearer
<CRON_SECRET>` header: `/api/monitoring/cron` (website checks, security scan,
Google sync, alerts; every 30 minutes), `/api/connecteam/cron` (the Connecteam
syncs; every 30 minutes) and `/api/bookings/cron` (website appointments into
Connecteam; every 5 minutes).

**Adding more sites** — no schema or code changes needed. Admin/Manager users
add a website from the Command Centre UI, or insert directly into the
`websites` table. Designed to scale to 100+ rows without redesign.

**Incidents & notifications** — every check syncs an `incidents` row (one
per continuous critical/offline spell, not one per check — see
`lib/monitoring/incidents.ts`). Two independent, optional channels notify
on incident open/resolve — checks still run and incidents still get
recorded without either configured, notifications are just silently
skipped:
- **Slack**: set `SLACK_WEBHOOK_URL` (Slack → Apps → Incoming Webhooks →
  Add to Slack → pick a channel → copy the URL).
- **WhatsApp**: set all 4 of `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_TO` (Twilio console → get a
  WhatsApp sender — their free Sandbox number works for fast testing, each
  recipient just needs to text the sandbox's join code once to opt in).
  `TWILIO_WHATSAPP_TO` accepts a comma-separated list to alert more than
  one person.

## Trade Sales CRM

A prospecting tool for Joanna and Sajad, with pipeline and results visible to Philip: companies and contacts, follow-ups,
sales opportunities, spreadsheet import and export, an overview and reports, and optional AI help. It is under
**🤝 Trade Sales CRM** in the dashboard menu.

**Who can do what** — Admin and Manager oversee, Staff work in it, Viewers have no access. Staff can add and edit
anything and log activity, but cannot delete records, export, undo an import, see the person-by-person comparison, or
change the settings. Manager can additionally delete, export, undo imports and see the comparison. Admin alone can erase a
company for good and change the pipeline stages, categories and AI wording. The rules live in `lib/crm/http.ts` and are
checked for every route by `lib/crm/permissions.test.ts`.

**Setup** — run these in the Supabase SQL editor, in order (each is safe to run twice):
`20261020100000_trade_crm.sql`, `20261021100000_crm_activities_tasks.sql`, `20261022100000_crm_import.sql`,
`20261023100000_crm_reports.sql`, `20261024100000_crm_ai.sql`, `20261025100000_crm_territories.sql`, `20261026100000_crm_whatsapp_activity.sql`, `20261027100000_crm_specials.sql`, `20261028100000_crm_whatsapp_templates.sql`, `20261029100000_crm_documents.sql`. The CRM tables have row-level security on and no policy,
so they are reachable only through the server routes (which check the role). Environment variables: `ANTHROPIC_API_KEY`
(already used elsewhere; only the AI tools need it) and, optionally, `CRM_AI_DAILY_LIMIT` (AI requests per person per day,
default 40). No other service, key or recurring cost is involved.

**Where the code is** — `lib/crm/` (rules, data access, reports), `lib/crm/import/` (reading and checking spreadsheets),
`lib/crm/export/`, `lib/crm/ai/` (prompts, website reading, checks on what the AI says), `app/api/crm/` (routes) and
`app/dashboard/crm/` (screens).

**Territories** — a company's county is one of the twelve Leinster counties, "Outside Leinster", or not set (`lib/crm/territories.ts`). Typed or imported spellings ("Co. Carlow", "Dublin 6W") are tidied to the fixed list; anything that is not a county is refused (or, on import, left out with a warning and kept on the company). The Territories tab and the "By county" report show every county side by side, and the company list can be filtered, and bulk-updated, by county. The 20261025 migration tidies existing records and makes the database enforce the list.

**Saving research** — a company's AI research can be saved with *Apply to this company* for one suggestion or *Apply all* for the lot, and phone numbers or emails found on its website can be saved with *Add to record*. Nothing already on the record is overwritten: text is added to, a filled phone, mobile or email field sends the new number to the notes instead, and one note line marks what came from the AI as unverified (`lib/crm/ai/apply.ts`).

**Specials** — an offer for one county (or all of them) between two dates, with the exact wording to use and an optional code. Admin and Manager set them up on the Territories tab; everyone sees what is running (in the territory table, and on a company's page for its county). The message drafter is given the offers running where the company is and may state only those, as written; a percentage or euro amount in a draft that is in neither the approved wording nor a current offer is flagged for checking. Each special shows what happened in its county while it ran next to the same number of days before it (the same counting as the reports; it shows what happened alongside, not what caused it). Switching a special off keeps its results; deleting removes them.

**Logging outreach in bulk** — WhatsApp message and WhatsApp follow-up are activity types. On the Companies list, tick companies (or use *Select all N that match*, up to 200) and choose *Log activity* to record one message against all of them, with the day it was really sent, its wording, and an optional follow-up for each. A company that already has that kind of activity on that day is skipped, so a second click cannot log it twice.

**Sending WhatsApp, one company at a time** — the Hub never sends a message itself. Tick companies and choose *Send WhatsApp*: a queue works through them in turn. For each it shows the number it will use (the company's mobile, else a phone or contact number that is an Irish mobile or foreign number; a landline alone is reported, not used), fills the fixed message and opens WhatsApp with it typed in (`wa.me` link). The person presses Send in WhatsApp, then *Sent, next*, which records a WhatsApp message (or follow-up) against that company with the text that went out, and can book a follow-up. Nothing is recorded until then. Companies that already had a WhatsApp recorded today are left out, and the last WhatsApp is shown so a repeat is noticed. An Admin writes the two fixed messages (first message and follow-up) in CRM Settings, using the blanks `{name}` (contact's first name, else "there"), `{company}`, `{county}`, `{sender}`, `{offer}` and `{code}` (the special running in the company's county; its own county beats a Leinster-wide one). A company whose message cannot be filled in (no special running for `{offer}`, no county, no mobile) is held back with the reason rather than sent with a gap. Until an Admin saves their own wording, neutral starter messages are used.

**Documents and quotes** — each company page has a Documents section: PDF, Word, Excel, JPG or PNG, up to 10 MB, with an optional note and an optional link to one of the company's opportunities. Files live in a private Supabase Storage bucket (`crm-documents`, created by the migration, which also sets the 10 MB and file-type limits on the bucket itself); nobody gets a public link. Adding a file is two steps so its size is not limited by the web server: the server checks the name, type and size and returns a one-off signed upload place in the company's folder (the stored name is made up, never the person's file name); the browser sends the file straight to storage; then the server checks the stored file's real size and its first bytes (a `.pdf` must start `%PDF-`, an `.xlsx` must be a zip, and so on) and only then records it. A file that fails is removed from storage again. The browser's own idea of the file type is ignored. Downloads go through a route that checks the role and redirects to a signed link that lasts one minute. Staff, Manager and Admin can add and download; only Manager and Admin can delete. Erasing a company for good removes its files first (and stops if one cannot be removed); undoing an import keeps any company that has a document. The log records the kind and size of a document, never its name. Documents are not added to the activity history, so they do not change the activity counts in the reports. There is no virus scan.

**Things worth knowing** — Imports read `.xlsx`, `.csv`, `.tsv` and `.txt`. Apple Numbers (`.numbers`), old `.xls` and PDF
files are recognised but must first be exported to Excel or CSV. A company is never changed by an import; anything that
looks like an existing company is held back for review. A sale counts only when it is marked Won with a value; estimates
are never counted as sales. Percentages are withheld when there are too few records to mean anything. The AI only
suggests: nothing is sent, saved or changed without a click, and it never sees a prospect's phone number or email.

**Testing** — `npx vitest run lib/crm` (the whole suite is `npx vitest run`). `lib/crm/acceptance.test.ts` walks through
the thirteen workflows the CRM was specified against, using the same routes the screens use. The tests use invented data
only; real lead spreadsheets must never be committed.
