import type { PpeRow } from "./ppe";
import { formatDate, type StaffRef } from "./vehicles-summary";

const DAY = 86_400_000;

export const PPE_RULES = {
  staleAfterDays: 30,
  popularWindowDays: 90,
  // A few requests have quantities like 320 or 666: almost certainly typos.
  maxPlausibleQuantity: 100,
} as const;

export type PpeSummaryRow = Pick<
  PpeRow,
  "submission_id" | "submitted_at" | "submitter_user_id" | "items" | "quantity" | "spray_suit_sizes" | "other_text" | "status" | "status_updated_at" | "manager_note"
>;

export type OpenRequest = {
  id: string;
  submittedAt: string;
  daysOld: number;
  requester: string;
  items: string[];
  quantity: number | null;
  sizes: string[];
  other: string | null;
  status: string | null;
  note: string | null;
};

/** Who asked for an item over the popularity window. Units count single-item requests only, like the item totals. */
export type Orderer = { name: string; requests: number; units: number; lastRequestedAt: string; open: number };

export type ItemStat = { item: string; requests: number; units: number; openRequests: number; lastRequestedAt: string; orderers: Orderer[] };

export type PpeOverview = {
  generatedAt: string;
  totals: { requests7: number; requests30: number; requests90: number; done30: number };
  openRecent: OpenRequest[];
  openStale: OpenRequest[];
  topItems: ItemStat[];
  sizes: { size: string; requests: number }[];
  medianHoursToDone: number | null;
};

// "Done" is the only finished state in this form; anything else (no status,
// "Working on it") still needs someone's attention.
const isOpen = (r: Pick<PpeSummaryRow, "status">) => r.status !== "Done";

export function summarisePpe(rows: PpeSummaryRow[], staff: StaffRef[], nowMs: number = Date.now()): PpeOverview {
  const t = (r: PpeSummaryRow) => new Date(r.submitted_at).getTime();
  const sorted = [...rows].sort((a, b) => t(b) - t(a));
  const since = (days: number) => nowMs - days * DAY;
  const nameById = new Map(staff.map((s) => [s.userId, s.name]));

  const toOpen = (r: PpeSummaryRow): OpenRequest => ({
    id: r.submission_id,
    submittedAt: r.submitted_at,
    daysOld: Math.floor((nowMs - t(r)) / DAY),
    requester: r.submitter_user_id !== null ? nameById.get(r.submitter_user_id) ?? `Connecteam user ${r.submitter_user_id}` : "Unknown",
    items: r.items,
    quantity: r.quantity,
    sizes: r.spray_suit_sizes,
    other: r.other_text,
    status: r.status,
    note: r.manager_note,
  });

  const open = sorted.filter(isOpen).map(toOpen);
  const last90 = sorted.filter((r) => t(r) >= since(PPE_RULES.popularWindowDays));

  const requesterName = (r: PpeSummaryRow) =>
    r.submitter_user_id !== null ? nameById.get(r.submitter_user_id) ?? `Connecteam user ${r.submitter_user_id}` : "Unknown";
  // One quantity covers the whole request, so units are only meaningful
  // when the request is for a single item.
  const unitsOf = (r: PpeSummaryRow) =>
    r.items.length === 1 && r.quantity !== null && r.quantity > 0 && r.quantity <= PPE_RULES.maxPlausibleQuantity ? r.quantity : 0;

  type Acc = { requests: number; units: number; open: number; lastMs: number };
  const bump = (a: Acc, r: PpeSummaryRow) => {
    a.requests += 1;
    a.units += unitsOf(r);
    if (isOpen(r)) a.open += 1;
    a.lastMs = Math.max(a.lastMs, t(r));
  };
  const fresh = (): Acc => ({ requests: 0, units: 0, open: 0, lastMs: 0 });

  const itemStats = new Map<string, { total: Acc; by: Map<string, Acc> }>();
  for (const r of last90) {
    const who = requesterName(r);
    for (const item of r.items) {
      const entry = itemStats.get(item) ?? { total: fresh(), by: new Map<string, Acc>() };
      bump(entry.total, r);
      const person = entry.by.get(who) ?? fresh();
      bump(person, r);
      entry.by.set(who, person);
      itemStats.set(item, entry);
    }
  }

  const sizeStats = new Map<string, number>();
  for (const r of last90) for (const size of r.spray_suit_sizes) sizeStats.set(size, (sizeStats.get(size) ?? 0) + 1);

  const hoursToDone = last90
    .filter((r) => r.status === "Done" && r.status_updated_at)
    .map((r) => (new Date(r.status_updated_at as string).getTime() - t(r)) / 3_600_000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    totals: {
      requests7: sorted.filter((r) => t(r) >= since(7)).length,
      requests30: sorted.filter((r) => t(r) >= since(30)).length,
      requests90: last90.length,
      done30: sorted.filter((r) => t(r) >= since(30) && !isOpen(r)).length,
    },
    openRecent: open.filter((r) => r.daysOld <= PPE_RULES.staleAfterDays),
    openStale: open.filter((r) => r.daysOld > PPE_RULES.staleAfterDays).sort((a, b) => b.daysOld - a.daysOld),
    topItems: Array.from(itemStats.entries())
      .map(([item, e]) => ({
        item,
        requests: e.total.requests,
        units: e.total.units,
        openRequests: e.total.open,
        lastRequestedAt: new Date(e.total.lastMs).toISOString(),
        orderers: Array.from(e.by.entries())
          .map(([name, a]) => ({ name, requests: a.requests, units: a.units, lastRequestedAt: new Date(a.lastMs).toISOString(), open: a.open }))
          .sort((a, b) => b.requests - a.requests || b.lastRequestedAt.localeCompare(a.lastRequestedAt) || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.requests - a.requests || a.item.localeCompare(b.item)),
    sizes: Array.from(sizeStats.entries())
      .map(([size, requests]) => ({ size, requests }))
      .sort((a, b) => b.requests - a.requests),
    medianHoursToDone: hoursToDone.length ? Math.round(hoursToDone[Math.floor(hoursToDone.length / 2)] * 10) / 10 : null,
  };
}

const clip = (s: string | null, n: number) => (s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null);

function describeRequest(r: OpenRequest): string {
  const bits = [
    `${formatDate(r.submittedAt)} (${r.daysOld}d ago) by ${r.requester}`,
    `items: ${r.items.join(", ") || "none ticked"}`,
    r.quantity !== null ? `quantity ${r.quantity}${r.items.length > 1 ? " (covers the whole request)" : ""}` : null,
    r.sizes.length ? `suit size ${r.sizes.join("/")}` : null,
    clip(r.other, 100) ? `details: ${clip(r.other, 100)}` : null,
    `status: ${r.status ?? "no status set"}`,
    clip(r.note, 100) ? `manager note: ${clip(r.note, 100)}` : null,
  ];
  return `- ${bits.filter(Boolean).join("; ")}`;
}

/** Plain-text block for Eleven's prompt, with lists already worked out. */
export function formatPpeContext(o: PpeOverview, lastSyncedAt: string | null): string {
  const lines: string[] = [];
  lines.push(
    `Source: Connecteam "Tools & PPE Order Request" form${lastSyncedAt ? `, last synced ${formatDate(lastSyncedAt)}` : ""}.`,
    `Definitions: a request is "done" only when a manager has set its status to Done in Connecteam; no status or "Working on it" counts as open. Open requests older than ${PPE_RULES.staleAfterDays} days are listed separately as probably forgotten or abandoned. Each request has ONE quantity even if several items are ticked, so unit totals only count single-item requests with a quantity of ${PPE_RULES.maxPlausibleQuantity} or less (larger numbers look like typos).`,
    `Totals: ${o.totals.requests7} requests in the last 7 days, ${o.totals.requests30} in the last 30 days (${o.totals.done30} done), ${o.totals.requests90} in the last 90 days. ${o.openRecent.length} open from the last ${PPE_RULES.staleAfterDays} days; ${o.openStale.length} older open requests. ${o.medianHoursToDone !== null ? `Requests marked Done are typically done within about ${o.medianHoursToDone} hours.` : ""}`
  );

  lines.push(`Open requests from the last ${PPE_RULES.staleAfterDays} days (${o.openRecent.length}):`);
  lines.push(...(o.openRecent.length ? o.openRecent.map(describeRequest) : ["- none"]));

  lines.push(`Older open requests, probably forgotten (${o.openStale.length}; oldest first, showing up to 30):`);
  lines.push(...(o.openStale.length ? o.openStale.slice(0, 30).map(describeRequest) : ["- none"]));

  lines.push(
    `Most requested items in the last ${PPE_RULES.popularWindowDays} days (number of requests; units from single-item requests): ` +
      (o.topItems.slice(0, 20).map((i) => `${i.item} ${i.requests} (${i.units} units)`).join("; ") || "none")
  );
  lines.push(`Who asked for each item in the last ${PPE_RULES.popularWindowDays} days (requests, units from single-item requests, still open, most recent request; most frequent first):`);
  for (const i of o.topItems.slice(0, 15)) {
    const people = i.orderers
      .slice(0, 8)
      .map((p) => `${p.name} ${p.requests}${p.units ? ` (${p.units} units)` : ""}${p.open ? `, ${p.open} open` : ""}, last ${formatDate(p.lastRequestedAt)}`)
      .join("; ");
    const more = i.orderers.length > 8 ? `; and ${i.orderers.length - 8} others` : "";
    lines.push(`- ${i.item} (${i.orderers.length} ${i.orderers.length === 1 ? "person" : "people"}): ${people}${more}`);
  }
  lines.push(
    `Spray suit sizes requested in the last ${PPE_RULES.popularWindowDays} days: ${o.sizes.map((s) => `${s.size} ${s.requests}`).join(", ") || "none"}.`
  );

  return lines.join("\n");
}
