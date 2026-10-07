import { normalizeReg } from "../connecteam/vehicles";

export const KINDS = ["licence", "insurance", "certificate", "training", "registration", "contract", "other"] as const;
export const HOLDER_TYPES = ["person", "vehicle", "company"] as const;
export const STATUSES = ["suggested", "confirmed", "dismissed"] as const;

export type ComplianceKind = (typeof KINDS)[number];
export type HolderType = (typeof HOLDER_TYPES)[number];
export type ComplianceStatus = (typeof STATUSES)[number];

export const KIND_LABEL: Record<ComplianceKind, string> = {
  licence: "Licence",
  insurance: "Insurance",
  certificate: "Certificate",
  training: "Training",
  registration: "Vehicle registration / NCT / tax",
  contract: "Contract",
  other: "Other",
};

export const HOLDER_LABEL: Record<HolderType, string> = { person: "Person", vehicle: "Vehicle", company: "Company" };

export type ComplianceItem = {
  id: string;
  document_id: string | null;
  title: string;
  kind: ComplianceKind;
  holder_type: HolderType;
  holder_label: string | null;
  issued_date: string | null;
  expiry_date: string | null;
  status: ComplianceStatus;
  source: "manual" | "extracted";
  evidence: string | null;
  needs_check: boolean;
  notes: string | null;
  alerted_stage: number;
};

const DAY = 86_400_000;

/** Whole days from `today` to `expiry` (both YYYY-MM-DD). Negative once it has lapsed. */
export function daysUntil(expiry: string, today: string): number {
  return Math.round((Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
}

// Warning stages: each is sent once, when an item first reaches it.
export const STAGE_LABEL: Record<number, string> = {
  0: "no warning yet",
  1: "30 days or less",
  2: "14 days or less",
  3: "7 days or less",
  4: "expired",
};

export function stageFor(days: number): number {
  if (days < 0) return 4;
  if (days <= 7) return 3;
  if (days <= 14) return 2;
  if (days <= 30) return 1;
  return 0;
}

export type Level = "expired" | "urgent" | "soon" | "watch" | "ok";

export function levelOf(days: number): Level {
  if (days < 0) return "expired";
  if (days <= 7) return "urgent";
  if (days <= 30) return "soon";
  if (days <= 90) return "watch";
  return "ok";
}

export function describeDays(days: number): string {
  if (days < 0) return `expired ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "expires today";
  return `${days} day${days === 1 ? "" : "s"} left`;
}

export type ComplianceSummary = {
  today: string;
  confirmed: number;
  suggested: number;
  expired: number;
  within7: number;
  within30: number;
  within90: number;
  /** Confirmed items with a date, soonest first (expired ones first of all). */
  dated: (ComplianceItem & { days: number })[];
};

export function summariseCompliance(items: ComplianceItem[], today: string): ComplianceSummary {
  const confirmed = items.filter((i) => i.status === "confirmed");
  const dated = confirmed
    .filter((i) => i.expiry_date)
    .map((i) => ({ ...i, days: daysUntil(i.expiry_date as string, today) }))
    .sort((a, b) => a.days - b.days || a.title.localeCompare(b.title));

  return {
    today,
    confirmed: confirmed.length,
    suggested: items.filter((i) => i.status === "suggested").length,
    expired: dated.filter((i) => i.days < 0).length,
    within7: dated.filter((i) => i.days >= 0 && i.days <= 7).length,
    within30: dated.filter((i) => i.days >= 0 && i.days <= 30).length,
    within90: dated.filter((i) => i.days >= 0 && i.days <= 90).length,
    dated,
  };
}

// ---- Warnings ----

export type PendingAlert = { item: ComplianceItem; days: number; stage: number };

/** Confirmed items that have moved into a more urgent stage than the one already warned about. */
export function pendingAlerts(items: ComplianceItem[], today: string): PendingAlert[] {
  return items
    .filter((i) => i.status === "confirmed" && i.expiry_date)
    .map((item) => {
      const days = daysUntil(item.expiry_date as string, today);
      return { item, days, stage: stageFor(days) };
    })
    .filter((a) => a.stage > a.item.alerted_stage)
    .sort((a, b) => a.days - b.days);
}

export function holderText(i: Pick<ComplianceItem, "holder_label" | "holder_type">): string {
  return i.holder_label ? i.holder_label : HOLDER_LABEL[i.holder_type].toLowerCase();
}

export function alertMessage(alerts: PendingAlert[]): string {
  const lines = alerts.map((a) => `• ${a.item.title} (${holderText(a.item)}): ${describeDays(a.days)}, ${a.item.expiry_date}`);
  return `⚠️ *Compliance: ${alerts.length} item${alerts.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} attention*\n${lines.join("\n")}`;
}

// ---- Gaps: things that should have a record and don't ----

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

/** "Seán O'Brien" and "o brien sean" are the same person for matching, order and punctuation aside. */
function sameName(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (x.length === 0 || y.length === 0) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 2 && short.every((w) => long.includes(w));
}

export type Gaps = {
  vehiclesWithoutInsurance: string[];
  vehiclesWithoutRegistration: string[];
  driversWithoutLicence: string[];
};

export function findGaps(items: ComplianceItem[], vehicles: { reg: string; key: string }[], drivers: string[]): Gaps {
  const confirmed = items.filter((i) => i.status === "confirmed");
  const forVehicle = (key: string, kind: ComplianceKind) =>
    confirmed.some((i) => i.holder_type === "vehicle" && i.kind === kind && i.holder_label && normalizeReg(i.holder_label) === key);
  const licences = confirmed.filter((i) => i.holder_type === "person" && i.kind === "licence" && i.holder_label);

  return {
    vehiclesWithoutInsurance: vehicles.filter((v) => !forVehicle(v.key, "insurance")).map((v) => v.reg),
    vehiclesWithoutRegistration: vehicles.filter((v) => !forVehicle(v.key, "registration")).map((v) => v.reg),
    driversWithoutLicence: drivers.filter((name) => !licences.some((l) => sameName(l.holder_label as string, name))),
  };
}

// ---- Text for Eleven ----

export function formatComplianceContext(summary: ComplianceSummary, gaps: Gaps, vehicleCount: number, driverCount: number): string {
  const lines: string[] = [
    `Source: the compliance register, kept by Admins. Only CONFIRMED items count; suggestions Eleven read from documents are not facts until confirmed. Today is ${summary.today}.`,
    `Definitions: "days left" counts from today to the expiry date; negative means it has lapsed. Warnings are sent at 30, 14 and 7 days before expiry and once expired. The register covers only what has been entered or uploaded, so an item missing from it may exist on paper but just not be recorded here.`,
    `Totals: ${summary.confirmed} confirmed items; ${summary.expired} expired; ${summary.within7} expiring within 7 days; ${summary.within30} within 30 days; ${summary.within90} within 90 days; ${summary.suggested} suggestions awaiting confirmation.`,
    "Confirmed items, soonest first:",
  ];
  for (const i of summary.dated.slice(0, 60)) {
    lines.push(`- ${i.title} [${KIND_LABEL[i.kind]}] for ${HOLDER_LABEL[i.holder_type].toLowerCase()}${i.holder_label ? ` ${i.holder_label}` : ""}: expires ${i.expiry_date} (${describeDays(i.days)})`);
  }
  if (summary.dated.length === 0) lines.push("- none recorded yet");

  lines.push(
    `Possible gaps (nothing confirmed on record, so check before assuming it's missing): of ${vehicleCount} regular vans, ${gaps.vehiclesWithoutInsurance.length} have no insurance record${gaps.vehiclesWithoutInsurance.length ? ` (${gaps.vehiclesWithoutInsurance.join(", ")})` : ""} and ${gaps.vehiclesWithoutRegistration.length} have no registration/NCT/tax record; of ${driverCount} regular drivers, ${gaps.driversWithoutLicence.length} have no driving licence on record${gaps.driversWithoutLicence.length ? ` (${gaps.driversWithoutLicence.join(", ")})` : ""}.`
  );
  return lines.join("\n");
}
