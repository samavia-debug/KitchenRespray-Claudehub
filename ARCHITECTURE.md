# Website Health & Monitoring Dashboard — Architecture

This documents what exists, what was added, what's reused, what still needs
credentials, and how the phased build-out maps onto the full spec. It's the
answer to the "FIRST TASK" inspection requirement — read this before starting
any new phase of work.

## 1. What already existed (before this pass)

The repo already had a working **Phase 1 MVP**, not a blank slate:

- **Stack**: Next.js 14 (App Router) + Supabase (Postgres, Auth, RLS) on
  Vercel. No separate backend service — API routes under `app/api/` are the
  server layer, Vercel Cron drives the scheduler.
- **Auth & roles**: Supabase Auth + a `profiles` table with `Admin` /
  `Manager` / `Staff` roles (from the pre-existing KitchenRespray dashboard
  work). `lib/auth/session.ts` has `getSessionProfile()` and `requireRole()`
  helpers already used consistently across the monitoring API routes.
- **Schema** (`supabase/migrations/20260919120000_monitoring_schema.sql`):
  `websites` + `website_health_checks` (append-only), plus two read-only
  views: `website_latest_check`, `website_uptime_7d`. RLS: any authenticated
  user can read; writes only via the service-role client in API routes.
- **Monitoring engine** (`lib/monitoring/`): `checker.ts` does a real HTTPS
  GET (10s timeout, follows redirects, 5xx = down) and a real TLS handshake
  (`node:tls`) for certificate validity/expiry — no mocked or invented data.
  `status.ts` derives a transparent, explainable status (`healthy` /
  `attention` / `critical` / `offline` / `unknown`) from fixed thresholds.
  `record.ts` persists a check with the service-role client. `alerts.ts`
  turns a status into a human-readable sentence.
- **Scheduler**: `/api/monitoring/cron` (Vercel Cron, every 30 min, bearer
  auth via `CRON_SECRET`), only checks sites whose own
  `monitoring_interval_minutes` has elapsed, bounded concurrency (5).
- **UI**: Command Centre (`/dashboard/monitoring`) with live summary cards,
  a critical-alerts panel, search/filter/sort website grid, an "Add website"
  form (Admin/Manager only), and a per-site detail page with tabs — the
  unbuilt tabs (GA, Search Console, SEO, Leads, WordPress, Alerts, Claude
  Analysis) explicitly render **"Not connected"**, never fabricated data.
- Seed data: 4 validation sites (`kitchenrespray.com`, `allsurfacerespray.com`,
  `kitchenfacelift.ie`, `tradesprayireland.com`).

This already matches the spec's core principle (§37, §41): every status is
traceable to a real measurement, unbuilt integrations say so instead of
guessing.

## 2. What this pass added

1. **`lib/monitoring/normalize.ts`** — shared domain normalization (strip
   protocol/path/query/port/`www.`, lowercase) so `https://example.com/`,
   `www.example.com`, and `example.com` never create duplicate rows (spec
   §1). Wired into the "Add website" API route, which previously only
   stripped the protocol and left `www.` untouched — a real bug, now fixed
   and covered by `lib/monitoring/normalize.test.ts`.
2. **`Role` type** extended with `Viewer` (`lib/auth/session.ts`) to match
   spec §25's four roles. The app currently treats Staff and Viewer
   identically (both read-only, matching existing RLS) — a real
   Staff-vs-Viewer permission split (e.g. "assigned websites only") is
   deferred; see §5.
3. **Full 60-site inventory migration**
   (`supabase/migrations/20260921120000_import_60_websites.sql`) — additive,
   `on conflict (domain) do nothing`, grouped into the spec's suggested
   categories (All Surface Respray / Kitchen Respray / Regional Kitchen
   Sites / Bathroom / Association / Other Businesses). See §3 for a data
   discrepancy this uncovered.
4. **`scripts/verify-websites.mjs`** — a standalone, read-only baseline
   check that runs the same kind of HTTPS GET + TLS probe as the production
   checker directly against all 60 real domains, without needing Supabase
   credentials. One GET request and one TLS handshake per domain, bounded
   concurrency (6), no repeats — polite, not a crawl. Also does a lightweight
   WordPress heuristic (`wp-content`/`wp-json` references, generator meta
   tag, `X-Powered-By`) as a one-time import signal (spec §39.7). This is how
   §39's "before monitoring: normalize, validate DNS, check HTTP/HTTPS,
   check SSL, identify WordPress" was actually executed and verified — see
   §4 for results.
5. **Test suite** — added `vitest` (pinned to v2, matching the existing
   `@types/node@^20`) and unit tests for `normalizeDomain` and
   `computeWebsiteStatus`/`sslDaysRemaining` (17 tests, `npm test`). These
   directly caught the `www.` bug and the "bare query string" edge case in
   normalization before either shipped.

## 3. Data discrepancy found — needs Philip's confirmation

The master 60-domain list gives site #1 as **`allsurfacerepray.com`**
("repray", missing the second "s"). Repeated DNS lookups from this
environment return `ENOTFOUND` — that domain does not resolve at all. The
already-seeded **`allsurfacerespray.com`** (correct spelling, matching the
business name "All Surface Respray") resolves fine and is live.

The import migration seeds the working, correctly-spelled domain rather than
the non-resolving one, so the flagship site doesn't sit permanently marked
"Offline" for what looks like a typo. **This needs a human decision**: if
`allsurfacerepray.com` is intentionally registered (e.g. a typo-catch domain)
it can be added separately once confirmed; right now it would only generate
false "Offline" alerts.

Also note: the original 4-site seed included `tradesprayireland.com`, which
does not appear anywhere in the new 60-site master list. Left in place
(nothing here deletes monitoring data) — flagging in case it's stale.

## 4. Baseline check results (real data, run 2026-09-21)

Ran `node scripts/verify-websites.mjs` against all 60 domains:

- **25 healthy, 26 attention, 1 critical, 8 offline** (by the same
  thresholds `status.ts` uses in production).
- **7 domains do not resolve via DNS at all** (`ENOTFOUND`, checked
  repeatedly): `bathresurfacingireland.com`, `bathreglazing.net`,
  `re-spray.com`, `epoxycountertopsireland.com`, `lashesbyeva.com`,
  `restoremyleather.com`, plus `allsurfacerepray.com` (see §3). These read
  as unregistered, expired, or never-pointed domains — not something the
  monitoring system can fix, but worth a human check before they're
  monitored (an unregistered domain will alert "Offline" forever).
- **`kitchenresprayireland.ie`** returned an inconsistent resolver error
  (`EAI_AGAIN`/`ENOTFOUND` across three separate attempts) — genuinely
  unresolved from this network, but `.ie` some registries are stricter about
  resolver behavior, so this one specifically should be re-checked from
  production before being treated as broken.
- **`respraymyfurniture.com`** returned HTTP 503 (critical) — a real server
  error, not a network failure.
- **Several sites returned HTTP 403** to the monitoring User-Agent
  (`worktoprespray.com`, `nationwidekitchenrespray.com`,
  `kitchenrespraydublin.com`, `kitchenrespraylaois.com`,
  `kitchenresprayoffaly.com`, `kitchenrespraykilkenny.com`,
  `kitchenrespraymeath.com`, `kitchenrespraycarlow.com`,
  `respraymykitchen.ie`, `ispaglobal.org`, `kitchenwrapireland.com`). This
  is flagged as `attention`, but a 403 to an automated User-Agent commonly
  means a WAF/bot-protection rule (Cloudflare, Sucuri, etc.) is blocking the
  monitor itself, not that the site is actually broken for real visitors.
  **This is a known false-positive risk worth root-causing before go-live**
  — likely fix is either allow-listing the monitor's IP/UA with each host's
  WAF, or treating a 403 differently from other 4xx codes.
- **40 of 60 sites show a detectable WordPress footprint** — useful triage
  signal for site #26 (WordPress/plugin monitoring) once credentials exist.
- Full machine-readable output: `scripts/website-baseline-report.json`
  (gitignored — regenerate anytime with `node scripts/verify-websites.mjs`).

This is the honest, currently-knowable state of the 60-site inventory
without any credentials beyond outbound network access.

## 5. What can run today vs. what needs credentials

| Capability | Status | Needs |
|---|---|---|
| HTTP/HTTPS availability, status code, response time | **Works now** | Nothing — outbound network only |
| SSL certificate validity/expiry | **Works now** | Nothing |
| WordPress detection (heuristic) | **Works now** (baseline script only, not yet wired into the recurring checker/schema) | Nothing |
| DNS resolution check | **Works now** (baseline script; not yet a persisted check type) | Nothing |
| Broken link crawling, redirect chains | Not built | Decide crawl scope/rate limits per site; still no external credential needed |
| SEO technical checks (robots.txt, sitemap, canonical, meta) | Not built | Nothing needed beyond build time — same as above |
| Domain expiry (WHOIS) | Not built | A WHOIS API (e.g. WhoisXML, RDAP where available) — needs an API key |
| Google Search Console | Not built | Google OAuth app + per-site GSC property access granted by each site owner |
| Google Analytics (GA4) | Not built | Google OAuth app + GA4 property access per site |
| WordPress plugin/theme/PHP version detail | Not built | Read-only WP credentials or an application-password/REST API key per site |
| Slack / Teams / Email notifications | Not built (architecture only) | Slack app token / Teams webhook / transactional email provider (e.g. Resend, SES) |
| Claude AI analysis layer | Not built | `ANTHROPIC_API_KEY` (already in `.env.example`) — straightforward once there's enough monitoring history to analyze |

Nothing in this list is guessed or assumed connected — every "Not built" tab
in the site detail page already says so explicitly rather than showing fake
green checkmarks.

## 6. Deferred by design (not overbuilt this pass)

Per spec §38 ("do not attempt every integration immediately") and the
existing codebase's own phase plan in `README.md`:

- **`website_groups` as a real table** with admin CRUD — the 60 sites are
  grouped today via the existing free-text `category` column (already
  filterable/searchable in the UI), which is enough for Phase 1/2. A proper
  groups table with membership management is real work and belongs once
  someone is actually managing groups day-to-day, not speculatively.
- **Persisted incidents / smart alerting with dedup** (spec §15-16) — status
  is currently computed live from the latest check on every page load, which
  is correct but doesn't yet track "how long has this been down" or send a
  single alert + recovery notice per incident. This is a real, scoped
  feature (new `incidents` table + state machine) for the next slice of
  Phase 1/2, not a one-line add.
- **Health score (0-100)** — the spec's multi-signal score needs SEO/perf/
  WordPress data this system doesn't have yet; today's `healthy/attention/
  critical/offline/unknown` status is the honest version of that until more
  signals exist.
- **AI Assistant / Claude analysis layer** — explicitly a later phase per
  the spec itself (§38 Phase 4); building it before there's real
  multi-signal data to analyze would mean either hallucinating insight or
  restating the dashboard in prose, neither of which is the point.

## 7. Priority alerts, recommended actions, and broken-link/blockage detection

Added in this pass, in response to a direct ask: "we also need Priority
alerts, needs action now, systematic finding and recommended actions, and
blockage or link break monitoring."

- **`lib/monitoring/recommendations.ts`** — `getFindings(status, check)` is a
  deterministic, rule-based findings engine: every finding traces to a
  specific measured field (HTTP status, SSL days remaining, response time,
  `likely_blocked`), each paired with concrete recommended actions ("check
  DNS records", "verify auto-renewal is enabled", "allow-list the monitor in
  the WAF"). This is intentionally **not** the Claude AI layer (§20/§38
  Phase 4) — it's the same transparent, no-invented-causes thresholding as
  `status.ts`, just phrased as findings + next steps instead of a single
  status word. `priorityScore(priority, status)` ranks issues by site
  priority × status severity, so a critical issue on a `critical`-priority
  site always outranks the same issue on a `low`-priority one.
- **Priority Alerts panel** (`app/dashboard/monitoring/alerts-panel.tsx`,
  renamed in place from the old critical/offline-only list) — now titled
  "Priority alerts — needs action now", lists every non-healthy site ranked
  by `priorityScore`, with its findings and recommended actions inline, plus
  a separate broken-links roll-up. Command Centre summary cards gained
  "Needs action now" and "Broken links found" tallies; the website grid
  gained an "Issues" column.
- **"Blockage" detection** (`detectLikelyBlocked` in `lib/monitoring/
  checker.ts`) — a 403/406/429/503 is checked against known WAF/bot-
  protection fingerprints (Cloudflare `cf-mitigated` header, `server:
  cloudflare`, Sucuri `via`/`x-sucuri-id` headers, common "verify you are
  human" body text) and flagged as `likely_blocked` on the health check
  (new column, `20260921140000_priority_alerts_and_links.sql`). This directly
  answers the false-positive risk flagged in §4 of this doc: a 403 now
  surfaces as "this looks like a WAF block, verify a real browser can load
  the site" instead of being indistinguishable from a genuine 4xx error.
  Purely heuristic — never asserted as confirmed fact, always phrased as
  "looks like" / "may indicate" in the UI copy.
- **Broken-link scanning** (`checkBrokenLinks` in `checker.ts`, new
  `website_link_checks` table) — homepage-only, capped at 25 links, bounded
  concurrency (5), HEAD-then-GET-fallback per link. This is a deliberate
  scope boundary, not a full-site crawl (spec §9's fuller broken-link/
  redirect-chain crawling stays a later phase) — it's a fast, polite spot-
  check that catches the common case (dead nav links, a removed page still
  linked from the homepage) without hammering the site or needing a crawl
  queue/worker architecture. Manually triggered per site ("Check links now",
  Admin/Manager only) rather than added to the 30-minute cron — link-
  checking 60 homepages plus every link on them on a schedule is real load
  on client sites that deserves its own rate-limit design before it's
  automatic. Upserted (not append-only like health checks) so
  `first_detected_at` survives across runs and a link's "how long has this
  been broken" is visible once it's checked more than once.
- Both are covered by new unit tests (`checker.test.ts`,
  `recommendations.test.ts`) — 21 new tests, 38 total, all passing.
- Re-validated against all 60 real domains with `scripts/verify-live-features.mjs`,
  which imports `checkWebsiteHealth`/`checkBrokenLinks` directly from
  `lib/monitoring/checker.ts` (Node 24's native TS support) rather than
  re-deriving the logic, so the result is guaranteed to match what
  production actually does. Result (2026-09-21, 12:29 UTC): 35 healthy, 17
  attention, 0 critical, 8 offline, **9 sites flagged `likely_blocked`**, **8
  sites with a broken homepage link (10 broken links total)**. One concrete
  catch from running the real code instead of hand-rolled logic: the
  original one-off baseline script (§4) mis-classified `respraymyfurniture.com`'s
  HTTP 503 as "critical" — the real `computeWebsiteStatus` logic classifies
  any non-2xx-capable response as `offline` first (`is_up` is false for any
  5xx), so it's actually "offline", not "critical". Fixed in this re-run;
  a reminder that re-deriving thresholds instead of calling the real
  function is exactly the kind of drift that causes dashboards to disagree
  with themselves.

**Deferred from this slice, on purpose**: persisted incidents with
open/resolved state and duration (§15-16, still needs its own `incidents`
table + state machine — see §6), and adding link-checks to the cron
schedule (needs a rate-limit/backoff design first, see above).

## 8. Next concrete steps

1. Apply `20260921120000_import_60_websites.sql` in Supabase, resolve the
   `allsurfacerepray.com` question with Philip first (§3).
2. Re-run `scripts/verify-websites.mjs` from a production-like network to
   confirm the 8 non-resolving domains and the 403s aren't
   environment-specific to this sandbox.
3. Decide the WAF/403 handling policy, then wire DNS-resolution and
   WordPress-detection into the recurring checker (needs one migration to
   add columns/tables) rather than just the one-off baseline script.
4. Build the `incidents` table + smart-alert dedup (§15-16) — the next
   highest-value slice, since it turns "status right now" into "how long has
   this actually been broken."
