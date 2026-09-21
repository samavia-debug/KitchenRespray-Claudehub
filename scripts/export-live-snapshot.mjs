// Pulls the CURRENT real state of the live Supabase project (the same
// project the running dev server is using) so an artifact snapshot can
// reflect actual data instead of a re-run baseline. Read-only, uses the
// service-role key already in .env.local. Never commit the output.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const [{ data: websites }, { data: latest }, { data: uptime }, { data: brokenLinks }] = await Promise.all([
  supabase.from("websites").select("*").order("name", { ascending: true }),
  supabase.from("website_latest_check").select("*"),
  supabase.from("website_uptime_7d").select("*"),
  supabase.from("website_broken_links_count").select("*"),
]);

const latestMap = new Map(latest.map((c) => [c.website_id, c]));
const uptimeMap = new Map(uptime.map((u) => [u.website_id, u]));
const brokenMap = new Map(brokenLinks.map((b) => [b.website_id, b.broken_count]));

function sslDaysRemaining(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function computeStatus(check) {
  if (!check) return "unknown";
  if (!check.is_up) return "offline";
  const sslDays = sslDaysRemaining(check.ssl_expires_at);
  if (check.ssl_valid === false) return "critical";
  if (sslDays !== null && sslDays <= 7) return "critical";
  if (check.response_time_ms !== null && check.response_time_ms > 5000) return "critical";
  if (sslDays !== null && sslDays <= 30) return "attention";
  if (check.response_time_ms !== null && check.response_time_ms > 2000) return "attention";
  return "healthy";
}

const rows = websites.map((w) => {
  const check = latestMap.get(w.id) || null;
  const uptimeRow = uptimeMap.get(w.id);
  return {
    name: w.name,
    domain: w.domain,
    category: w.category,
    priority: w.priority,
    status: computeStatus(check),
    http: check?.http_status ?? null,
    ms: check?.response_time_ms ?? null,
    ssl: check ? sslDaysRemaining(check.ssl_expires_at) : null,
    err: check?.error_message ?? null,
    blocked: check?.likely_blocked ?? false,
    brokenLinkCount: brokenMap.get(w.id) || 0,
    lastChecked: check?.checked_at ?? null,
    uptime7d: uptimeRow?.uptime_percent ?? null,
  };
});

writeFileSync(new URL("./live-snapshot.json", import.meta.url), JSON.stringify(rows, null, 2));
console.log(`Exported ${rows.length} sites.`);
console.log(
  JSON.stringify(
    {
      total: rows.length,
      healthy: rows.filter((r) => r.status === "healthy").length,
      attention: rows.filter((r) => r.status === "attention").length,
      critical: rows.filter((r) => r.status === "critical").length,
      offline: rows.filter((r) => r.status === "offline").length,
      unknown: rows.filter((r) => r.status === "unknown").length,
    },
    null,
    2
  )
);
