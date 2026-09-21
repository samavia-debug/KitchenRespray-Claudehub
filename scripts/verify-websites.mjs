// One-off, read-only baseline check for the 60-site master inventory.
// Runs the same kind of GET + TLS probe the production checker uses (see
// lib/monitoring/checker.ts) directly against the real domains, without
// needing Supabase credentials. Bounded concurrency + no repeat requests
// per site, so it never hammers any of the target servers.
//
// Usage: node scripts/verify-websites.mjs
// Output: scripts/website-baseline-report.json + a markdown summary on stdout.

import * as tls from "node:tls";
import { writeFile } from "node:fs/promises";

const SITES = [
  ["All Surface Respray", "allsurfacerepray.com", "All Surface Respray"],
  ["Kitchen Respray Ireland", "kitchenrespray.ie", "Kitchen Respray"],
  ["iSpa Global", "ispaglobal.org", "Association"],
  ["Bathroom Wrap", "bathroomwrap.com", "Bathroom"],
  ["Kitchen Wrap Ireland", "kitchenwrapireland.com", "Kitchen Respray"],
  ["Kitchen Respray", "kitchenrespray.com", "Kitchen Respray"],
  ["Bath Respray", "bathrespray.com", "Bathroom"],
  ["Kitchen Facelift", "kitchenfacelift.ie", "Kitchen Respray"],
  ["Respray.ie", "respray.ie", "Kitchen Respray"],
  ["Spray On Metals", "sprayonmetals.com", "Other Businesses"],
  ["Bath Reglazing Ireland", "bathreglazingireland.com", "Bathroom"],
  ["PVC Respray", "pvcrespray.com", "Other Businesses"],
  ["All Surface Repair", "allsurfacerepair.com", "All Surface Respray"],
  ["Resurface My Kitchen", "resurfacemykitchen.com", "Kitchen Respray"],
  ["Kitchen Resurfacing Ireland", "kitchenresurfacingireland.com", "Kitchen Respray"],
  ["Worktop Respray", "worktoprespray.com", "Kitchen Respray"],
  ["Respray Photos", "resprayphotos.com", "Other Businesses"],
  ["Furniture Respray", "furniturerespray.com", "Other Businesses"],
  ["Kitchen Respray Ireland (.com)", "kitchenresprayireland.com", "Kitchen Respray"],
  ["Nationwide Kitchen Respray", "nationwidekitchenrespray.com", "Kitchen Respray"],
  ["Kitchen Respray Galway", "kitchenrespraygalway.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Cork", "kitchenrespraycork.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Dublin", "kitchenrespraydublin.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Limerick", "kitchenrespraylimerick.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Laois", "kitchenrespraylaois.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Wexford", "kitchenrespraywexford.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Offaly", "kitchenresprayoffaly.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Kildare", "kitchenrespraykildare.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Kilkenny", "kitchenrespraykilkenny.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Louth", "kitchenrespraylouth.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Meath", "kitchenrespraymeath.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Waterford", "kitchenrespraywaterford.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Cavan", "kitchenrespraycavan.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Longford", "kitchenrespraylongford.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Tipperary", "kitchenrespraytipperary.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Wicklow", "kitchenrespraywicklow.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Donegal", "kitchenrespraydonegal.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Sligo", "kitchenrespraysligo.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Leitrim", "kitchenresprayleitrim.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Monaghan", "kitchenrespraymonaghan.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Mayo", "kitchenrespraymayo.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Roscommon", "kitchenresprayroscommon.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Clare", "kitchenresprayclare.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Carlow", "kitchenrespraycarlow.com", "Regional Kitchen Sites"],
  ["Kitchen Respray Kerry", "kitchenrespraykerry.com", "Regional Kitchen Sites"],
  ["All Surface Wrap", "allsurfacewrap.com", "All Surface Respray"],
  ["All Surface Veneer", "allsurfaceveneer.com", "All Surface Respray"],
  ["International Spray Painters Association", "internationalspraypaintersassociation.org", "Association"],
  ["Kitchen Respray Ireland (.ie)", "kitchenresprayireland.ie", "Kitchen Respray"],
  ["Respray My Kitchen", "respraymykitchen.ie", "Kitchen Respray"],
  ["Bath Resurfacing Ireland", "bathresurfacingireland.com", "Bathroom"],
  ["Bath Reglazing", "bathreglazing.net", "Bathroom"],
  ["Re-Spray", "re-spray.com", "Other Businesses"],
  ["Epoxy Countertops Ireland", "epoxycountertopsireland.com", "Kitchen Respray"],
  ["Lashes by Eva", "lashesbyeva.com", "Other Businesses"],
  ["Kitchen Respray Review", "kitchenresprayreview.com", "Kitchen Respray"],
  ["Respray My Furniture", "respraymyfurniture.com", "Other Businesses"],
  ["Restore My Leather", "restoremyleather.com", "Other Businesses"],
  ["Peter White Tours", "peterwhitetours.com", "Other Businesses"],
  ["Best Price Kitchen Respray", "bestpricekitchenrespray.com", "Kitchen Respray"],
];

const HTTP_TIMEOUT_MS = 10_000;
const TLS_TIMEOUT_MS = 8_000;
const CONCURRENCY = 6;
const BODY_BYTE_LIMIT = 50_000; // enough for <head> + a bit of <body>, no need to pull the whole page

function detectWordPress(headers, bodySnippet) {
  const poweredBy = headers.get("x-powered-by") || "";
  const link = headers.get("link") || "";
  const body = bodySnippet.toLowerCase();
  const signals = [];
  if (/wp-content|wp-includes|wp-json/.test(body)) signals.push("wp-content/wp-json reference in HTML");
  if (/name="generator"\s+content="wordpress/i.test(bodySnippet)) signals.push("generator meta tag");
  if (/wp-json/i.test(link)) signals.push("wp-json Link header");
  if (/wordpress/i.test(poweredBy)) signals.push("X-Powered-By header");
  return { detected: signals.length > 0, signals };
}

async function probeHttp(domain) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const start = Date.now();
  const url = `https://${domain}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "AllSurfaceRespray-Monitoring/1.0 (+website health baseline check)" },
      cache: "no-store",
    });
    const responseTimeMs = Date.now() - start;

    let bodySnippet = "";
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        let received = 0;
        while (received < BODY_BYTE_LIMIT) {
          const { done, value } = await reader.read();
          if (done) break;
          bodySnippet += decoder.decode(value, { stream: true });
          received += value.length;
        }
        reader.cancel().catch(() => {});
      }
    } catch {
      // body read best-effort only — never fails the probe
    }

    const wp = detectWordPress(res.headers, bodySnippet);

    return {
      reachable: true,
      httpStatus: res.status,
      finalUrl: res.url,
      redirected: res.url.replace(/\/$/, "") !== url.replace(/\/$/, ""),
      responseTimeMs,
      wordpress: wp,
      errorMessage: null,
    };
  } catch (err) {
    const responseTimeMs = Date.now() - start;
    const message = err?.name === "AbortError" ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err?.message || "Request failed";
    return {
      reachable: false,
      httpStatus: null,
      finalUrl: null,
      redirected: false,
      responseTimeMs,
      wordpress: { detected: false, signals: [] },
      errorMessage: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function probeSsl(domain) {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect({ host: domain, port: 443, servername: domain, timeout: TLS_TIMEOUT_MS }, () => {
      if (settled) return;
      settled = true;
      const cert = socket.getPeerCertificate();
      const sslValid = socket.authorized ?? null;
      const sslExpiresAt = cert && cert.valid_to ? new Date(cert.valid_to).toISOString() : null;
      const issuer = cert?.issuer?.O || cert?.issuer?.CN || null;
      socket.end();
      resolve({ sslValid, sslExpiresAt, issuer, error: socket.authorized ? null : socket.authorizationError || null });
    });

    socket.on("error", (err) => {
      if (settled) return;
      settled = true;
      resolve({ sslValid: null, sslExpiresAt: null, issuer: null, error: err?.message || "TLS connection failed" });
    });

    socket.on("timeout", () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ sslValid: null, sslExpiresAt: null, issuer: null, error: "TLS handshake timed out" });
    });
  });
}

function sslDaysRemaining(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

async function probeSite([name, domain, category]) {
  const [http, ssl] = await Promise.all([probeHttp(domain), probeSsl(domain)]);
  const sslDays = sslDaysRemaining(ssl.sslExpiresAt);

  let status;
  if (!http.reachable) status = "offline";
  else if (http.httpStatus >= 500) status = "critical";
  else if (ssl.sslValid === false || (sslDays !== null && sslDays <= 7)) status = "critical";
  else if (http.httpStatus >= 400 || (sslDays !== null && sslDays <= 30) || http.responseTimeMs > 2000) status = "attention";
  else status = "healthy";

  return { name, domain, category, status, http, ssl: { ...ssl, daysRemaining: sslDays } };
}

async function runBatched(items, worker, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(worker));
    results.push(...batchResults);
    process.stderr.write(`checked ${Math.min(i + concurrency, items.length)}/${items.length}\n`);
  }
  return results;
}

const results = await runBatched(SITES, probeSite, CONCURRENCY);

const summary = {
  total: results.length,
  healthy: results.filter((r) => r.status === "healthy").length,
  attention: results.filter((r) => r.status === "attention").length,
  critical: results.filter((r) => r.status === "critical").length,
  offline: results.filter((r) => r.status === "offline").length,
  wordpressDetected: results.filter((r) => r.http.wordpress.detected).length,
  generatedAt: new Date().toISOString(),
};

await writeFile(
  new URL("./website-baseline-report.json", import.meta.url),
  JSON.stringify({ summary, results }, null, 2)
);

console.log(`\n# Website baseline report — ${summary.generatedAt}\n`);
console.log(
  `${summary.total} sites checked — ${summary.healthy} healthy, ${summary.attention} attention, ${summary.critical} critical, ${summary.offline} offline. WordPress detected on ${summary.wordpressDetected}.\n`
);
console.log("| Site | Domain | Status | HTTP | Response | SSL days | WordPress |");
console.log("|---|---|---|---|---|---|---|");
for (const r of results) {
  console.log(
    `| ${r.name} | ${r.domain} | ${r.status} | ${r.http.httpStatus ?? "—"} | ${r.http.responseTimeMs}ms | ${
      r.ssl.daysRemaining ?? "—"
    } | ${r.http.wordpress.detected ? "yes" : "no"} |`
  );
}
