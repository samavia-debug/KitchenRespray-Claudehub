// Re-baseline using the ACTUAL production monitoring code (imported directly,
// not re-derived) so the "live" artifact reflects genuinely measured data:
// HTTP/SSL status, the new likely_blocked WAF heuristic, and a homepage
// broken-link scan — all via lib/monitoring/checker.ts, read-only, one pass
// per site, bounded concurrency.
//
// Usage: node scripts/verify-live-features.mjs

import { writeFile } from "node:fs/promises";
import { checkWebsiteHealth, checkBrokenLinks } from "../lib/monitoring/checker.ts";

const SITES = [
  ["All Surface Respray", "allsurfacerespray.com", "All Surface Respray", "high"],
  ["Kitchen Respray Ireland", "kitchenrespray.ie", "Kitchen Respray", "medium"],
  ["iSpa Global", "ispaglobal.org", "Association", "medium"],
  ["Bathroom Wrap", "bathroomwrap.com", "Bathroom", "medium"],
  ["Kitchen Wrap Ireland", "kitchenwrapireland.com", "Kitchen Respray", "medium"],
  ["Kitchen Respray", "kitchenrespray.com", "Kitchen Respray", "high"],
  ["Bath Respray", "bathrespray.com", "Bathroom", "medium"],
  ["Kitchen Facelift", "kitchenfacelift.ie", "Kitchen Respray", "high"],
  ["Respray.ie", "respray.ie", "Kitchen Respray", "medium"],
  ["Spray On Metals", "sprayonmetals.com", "Other Businesses", "medium"],
  ["Bath Reglazing Ireland", "bathreglazingireland.com", "Bathroom", "medium"],
  ["PVC Respray", "pvcrespray.com", "Other Businesses", "medium"],
  ["All Surface Repair", "allsurfacerepair.com", "All Surface Respray", "medium"],
  ["Resurface My Kitchen", "resurfacemykitchen.com", "Kitchen Respray", "medium"],
  ["Kitchen Resurfacing Ireland", "kitchenresurfacingireland.com", "Kitchen Respray", "medium"],
  ["Worktop Respray", "worktoprespray.com", "Kitchen Respray", "medium"],
  ["Respray Photos", "resprayphotos.com", "Other Businesses", "medium"],
  ["Furniture Respray", "furniturerespray.com", "Other Businesses", "medium"],
  ["Kitchen Respray Ireland (.com)", "kitchenresprayireland.com", "Kitchen Respray", "medium"],
  ["Nationwide Kitchen Respray", "nationwidekitchenrespray.com", "Kitchen Respray", "medium"],
  ["Kitchen Respray Galway", "kitchenrespraygalway.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Cork", "kitchenrespraycork.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Dublin", "kitchenrespraydublin.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Limerick", "kitchenrespraylimerick.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Laois", "kitchenrespraylaois.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Wexford", "kitchenrespraywexford.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Offaly", "kitchenresprayoffaly.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Kildare", "kitchenrespraykildare.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Kilkenny", "kitchenrespraykilkenny.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Louth", "kitchenrespraylouth.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Meath", "kitchenrespraymeath.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Waterford", "kitchenrespraywaterford.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Cavan", "kitchenrespraycavan.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Longford", "kitchenrespraylongford.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Tipperary", "kitchenrespraytipperary.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Wicklow", "kitchenrespraywicklow.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Donegal", "kitchenrespraydonegal.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Sligo", "kitchenrespraysligo.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Leitrim", "kitchenresprayleitrim.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Monaghan", "kitchenrespraymonaghan.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Mayo", "kitchenrespraymayo.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Roscommon", "kitchenresprayroscommon.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Clare", "kitchenresprayclare.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Carlow", "kitchenrespraycarlow.com", "Regional Kitchen Sites", "medium"],
  ["Kitchen Respray Kerry", "kitchenrespraykerry.com", "Regional Kitchen Sites", "medium"],
  ["All Surface Wrap", "allsurfacewrap.com", "All Surface Respray", "medium"],
  ["All Surface Veneer", "allsurfaceveneer.com", "All Surface Respray", "medium"],
  ["International Spray Painters Association", "internationalspraypaintersassociation.org", "Association", "medium"],
  ["Kitchen Respray Ireland (.ie)", "kitchenresprayireland.ie", "Kitchen Respray", "medium"],
  ["Respray My Kitchen", "respraymykitchen.ie", "Kitchen Respray", "medium"],
  ["Bath Resurfacing Ireland", "bathresurfacingireland.com", "Bathroom", "medium"],
  ["Bath Reglazing", "bathreglazing.net", "Bathroom", "medium"],
  ["Re-Spray", "re-spray.com", "Other Businesses", "medium"],
  ["Epoxy Countertops Ireland", "epoxycountertopsireland.com", "Kitchen Respray", "medium"],
  ["Lashes by Eva", "lashesbyeva.com", "Other Businesses", "low"],
  ["Kitchen Respray Review", "kitchenresprayreview.com", "Kitchen Respray", "medium"],
  ["Respray My Furniture", "respraymyfurniture.com", "Other Businesses", "medium"],
  ["Restore My Leather", "restoremyleather.com", "Other Businesses", "medium"],
  ["Peter White Tours", "peterwhitetours.com", "Other Businesses", "low"],
  ["Best Price Kitchen Respray", "bestpricekitchenrespray.com", "Kitchen Respray", "medium"],
];

const SITE_CONCURRENCY = 8;

function sslDaysRemaining(iso) {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function computeStatus(check) {
  if (!check.isUp) return "offline";
  const sslDays = sslDaysRemaining(check.sslExpiresAt);
  if (check.sslValid === false) return "critical";
  if (sslDays !== null && sslDays <= 7) return "critical";
  if (check.responseTimeMs !== null && check.responseTimeMs > 5000) return "critical";
  if (sslDays !== null && sslDays <= 30) return "attention";
  if (check.responseTimeMs !== null && check.responseTimeMs > 2000) return "attention";
  if (check.httpStatus !== null && check.httpStatus >= 400) return "attention";
  return "healthy";
}

async function probeSite([name, domain, category, priority]) {
  const health = await checkWebsiteHealth(domain);
  const status = computeStatus(health);
  const links = health.isUp ? await checkBrokenLinks(domain) : [];
  const brokenLinks = links.filter((l) => l.isBroken);

  return {
    name,
    domain,
    category,
    priority,
    status,
    http: health.httpStatus,
    ms: health.responseTimeMs,
    ssl: sslDaysRemaining(health.sslExpiresAt),
    sslValid: health.sslValid,
    err: health.errorMessage,
    likelyBlocked: health.likelyBlocked,
    linksChecked: links.length,
    brokenLinks: brokenLinks.map((l) => ({ target: l.targetUrl, type: l.linkType, status: l.httpStatus, error: l.errorMessage })),
  };
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

const results = await runBatched(SITES, probeSite, SITE_CONCURRENCY);

const summary = {
  total: results.length,
  healthy: results.filter((r) => r.status === "healthy").length,
  attention: results.filter((r) => r.status === "attention").length,
  critical: results.filter((r) => r.status === "critical").length,
  offline: results.filter((r) => r.status === "offline").length,
  likelyBlocked: results.filter((r) => r.likelyBlocked).length,
  sitesWithBrokenLinks: results.filter((r) => r.brokenLinks.length > 0).length,
  totalBrokenLinks: results.reduce((sum, r) => sum + r.brokenLinks.length, 0),
  generatedAt: new Date().toISOString(),
};

await writeFile(new URL("./live-baseline-report.json", import.meta.url), JSON.stringify({ summary, results }, null, 2));

console.log(JSON.stringify(summary, null, 2));
