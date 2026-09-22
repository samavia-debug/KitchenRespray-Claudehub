// One-time cleanup: permanently removes the 35 sites descoped from the
// original 61-site inventory down to the 26 the business actually wants
// monitored. Cascades (via FK on delete cascade) to delete all of that
// site's health_checks, link_checks, seo_checks, incidents, and
// google_connections too — this is intentionally destructive, run only
// after explicit user confirmation.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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

const DOMAINS_TO_REMOVE = [
  "bathroomwrap.com",
  "kitchenwrapireland.com",
  "sprayonmetals.com",
  "bathreglazingireland.com",
  "allsurfacerepair.com",
  "resurfacemykitchen.com",
  "kitchenresurfacingireland.com",
  "kitchenrespraygalway.com",
  "kitchenrespraycork.com",
  "kitchenrespraylimerick.com",
  "kitchenrespraywaterford.com",
  "kitchenrespraycavan.com",
  "kitchenrespraytipperary.com",
  "kitchenrespraydonegal.com",
  "kitchenrespraysligo.com",
  "kitchenresprayleitrim.com",
  "kitchenrespraymonaghan.com",
  "kitchenrespraymayo.com",
  "kitchenresprayroscommon.com",
  "kitchenresprayclare.com",
  "kitchenrespraykerry.com",
  "allsurfaceveneer.com",
  "internationalspraypaintersassociation.org",
  "kitchenresprayireland.ie",
  "respraymykitchen.ie",
  "bathresurfacingireland.com",
  "bathreglazing.net",
  "re-spray.com",
  "epoxycountertopsireland.com",
  "lashesbyeva.com",
  "kitchenresprayreview.com",
  "respraymyfurniture.com",
  "restoremyleather.com",
  "peterwhitetours.com",
  "tradesprayireland.com",
];

console.log(`Attempting to delete ${DOMAINS_TO_REMOVE.length} sites...`);

const { data: before } = await supabase.from("websites").select("id, domain").in("domain", DOMAINS_TO_REMOVE);
console.log(`Found ${before.length} matching rows before delete.`);

const missing = DOMAINS_TO_REMOVE.filter((d) => !before.some((w) => w.domain === d));
if (missing.length > 0) {
  console.log("WARNING — these domains were not found in the database:", missing);
}

const { error, count } = await supabase
  .from("websites")
  .delete({ count: "exact" })
  .in("domain", DOMAINS_TO_REMOVE);

if (error) {
  console.error("DELETE FAILED:", error);
  process.exit(1);
}

console.log(`Deleted ${count} rows.`);

const { data: remaining, count: remainingCount } = await supabase
  .from("websites")
  .select("name, domain", { count: "exact" })
  .order("name");

console.log(`\nRemaining sites: ${remainingCount}`);
remaining.forEach((w) => console.log(`  - ${w.name} (${w.domain})`));
