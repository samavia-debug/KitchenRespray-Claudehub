import { validIsoDate } from "../compliance/extract";
import { daysUntil, describeDays, levelOf, stageFor, type Level } from "../compliance/summary";
import { normalizeReg } from "../connecteam/vehicles";

// The company's vans: what each is worth, what is still owed on it, who has it, and when its tax, DOE and
// insurance are due. Kept by Admins (it holds finance figures), never sent to the AI service.

export const DUE_KINDS = ["tax", "doe", "insurance"] as const;
export type DueKind = (typeof DUE_KINDS)[number];
export const DUE_LABEL: Record<DueKind, string> = { tax: "Tax", doe: "DOE", insurance: "Insurance" };

export const VAN_STATUSES = ["active", "gone"] as const;
export type VanStatus = (typeof VAN_STATUSES)[number];

export type Van = {
  id: string;
  reg: string;
  reg_key: string;
  model: string | null;
  driver: string | null;
  lender: string | null;
  agreement: string | null;
  value_eur: number | null;
  monthly_eur: number | null;
  /** What is still owed to the lender; 0 once it is paid off. */
  settlement_eur: number | null;
  weight_kg: number | null;
  tax_pin: string | null;
  tax_due: string | null;
  doe_due: string | null;
  insurance_due: string | null;
  tax_alerted_stage: number;
  doe_alerted_stage: number;
  insurance_alerted_stage: number;
  status: VanStatus;
  notes: string | null;
  updated_at: string;
};

export type VanInput = {
  reg: string;
  model: string | null;
  driver: string | null;
  lender: string | null;
  agreement: string | null;
  value_eur: number | null;
  monthly_eur: number | null;
  settlement_eur: number | null;
  weight_kg: number | null;
  tax_pin: string | null;
  tax_due: string | null;
  doe_due: string | null;
  insurance_due: string | null;
  status: VanStatus;
  notes: string | null;
};

export const dueField = (kind: DueKind) => `${kind}_due` as const;
export const alertedField = (kind: DueKind) => `${kind}_alerted_stage` as const;

/** Irish registrations: a year, a county code and a number, such as 161D5265 or 192DL678. */
export const IRISH_REG = /^\d{2,3}[A-Z]{1,2}\d{1,6}$/;

/** "161 D  5265" as "161 D 5265": upper case, single spaces. */
export function tidyReg(reg: string): string {
  return reg.toUpperCase().replace(/\s+/g, " ").trim();
}

export const regKey = normalizeReg;

// ---- Reading values ----

/** `undefined` when the cell is blank, `null` when it is something that is not an amount, 0 for "paid". */
export function parseMoney(text: string | null | undefined): number | null | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  if (/^paid\b/i.test(t)) return 0;
  const cleaned = t.replace(/[€\s,]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Math.round(Number(cleaned) * 100) / 100;
  return Number.isFinite(n) && n >= 0 && n <= 10_000_000 ? n : null;
}

export function parseWeight(text: string | null | undefined): number | null {
  const digits = /(\d[\d,.]*)/.exec(text ?? "")?.[1]?.replace(/[,.]/g, "");
  const n = digits ? Number(digits) : NaN;
  return Number.isInteger(n) && n > 0 && n <= 50_000 ? n : null;
}

const MONTH = /^(jan|feb|mar|apr|abr|may|jun|jul|aug|agu|sep|oct|nov|dec)[a-z]*\.?$/i;

/**
 * A due date as typed in a spreadsheet: a date (day first, as in Ireland), an Excel date number or a written date.
 * `monthOnly` is true when all that is there is a month name such as "june", which is not a date anyone can be warned about.
 */
export function parseDueDate(text: string | null | undefined): { date: string | null; monthOnly: boolean } {
  const t = (text ?? "").trim();
  if (!t) return { date: null, monthOnly: false };

  const iso = validIsoDate(t);
  if (iso) return { date: iso, monthOnly: false };

  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const serial = Math.floor(Number(t));
    if (serial >= 30_000 && serial <= 80_000) return { date: new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10), monthOnly: false };
  }

  const dmy = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/.exec(t);
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    const date = validIsoDate(`${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`);
    return { date, monthOnly: false };
  }

  return { date: null, monthOnly: MONTH.test(t) };
}

// ---- Checking what the page sends ----

const text = (v: unknown, max: number): string | null => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max) : "";
  return s || null;
};
const money = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseMoney(String(v));
  return typeof n === "number" && n >= 0 && n <= 10_000_000 ? Math.round(n * 100) / 100 : null;
};

export function cleanVanInput(raw: unknown): { value: VanInput } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Nothing was sent" };
  const b = raw as Record<string, unknown>;

  const reg = tidyReg(typeof b.reg === "string" ? b.reg : "");
  const key = regKey(reg);
  if (key.length < 4 || key.length > 14) return { error: "Enter the registration, such as 191 D 30807" };

  for (const kind of DUE_KINDS) {
    const v = b[dueField(kind)];
    if (typeof v === "string" && v.trim() && !validIsoDate(v.trim())) return { error: `${DUE_LABEL[kind]} date is not a valid date` };
  }
  for (const [label, v] of [["Value", b.value_eur], ["Monthly payment", b.monthly_eur], ["Amount owed", b.settlement_eur]] as const) {
    if (v !== null && v !== undefined && v !== "" && money(v) === null) return { error: `${label} must be an amount in euro` };
  }

  const weight = b.weight_kg === null || b.weight_kg === undefined || b.weight_kg === "" ? null : Number(b.weight_kg);
  if (weight !== null && !(Number.isInteger(weight) && weight > 0 && weight <= 50_000)) return { error: "Weight must be in kilograms" };

  const due = (kind: DueKind) => (typeof b[dueField(kind)] === "string" ? validIsoDate((b[dueField(kind)] as string).trim()) : null);

  return {
    value: {
      reg,
      model: text(b.model, 80),
      driver: text(b.driver, 80),
      lender: text(b.lender, 80),
      agreement: text(b.agreement, 80),
      value_eur: money(b.value_eur),
      monthly_eur: money(b.monthly_eur),
      settlement_eur: money(b.settlement_eur),
      weight_kg: weight,
      tax_pin: text(b.tax_pin, 40),
      tax_due: due("tax"),
      doe_due: due("doe"),
      insurance_due: due("insurance"),
      status: b.status === "gone" ? "gone" : "active",
      notes: typeof b.notes === "string" ? b.notes.replace(/\r\n/g, "\n").trim().slice(0, 1000) || null : null,
    },
  };
}

// ---- Totals and due dates ----

/** What the van is worth less what is still owed on it. */
export const equityOf = (v: Pick<Van, "value_eur" | "settlement_eur">): number | null =>
  v.value_eur === null ? null : Math.round((v.value_eur - (v.settlement_eur ?? 0)) * 100) / 100;

export type FleetTotals = { vans: number; value: number; owed: number; equity: number; monthly: number };

export function fleetTotals(vans: Van[]): FleetTotals {
  const active = vans.filter((v) => v.status === "active");
  const sum = (f: (v: Van) => number | null) => Math.round(active.reduce((t, v) => t + (f(v) ?? 0), 0) * 100) / 100;
  return { vans: active.length, value: sum((v) => v.value_eur), owed: sum((v) => v.settlement_eur), equity: sum((v) => equityOf(v)), monthly: sum((v) => v.monthly_eur) };
}

export type DueItem = { van: Van; kind: DueKind; date: string; days: number; level: Level; text: string };

export function dueItem(van: Van, kind: DueKind, today: string): DueItem | null {
  const date = van[dueField(kind)];
  if (!date) return null;
  const days = daysUntil(date, today);
  return { van, kind, date, days, level: levelOf(days), text: describeDays(days) };
}

/** Active vans' dates that are overdue or due within `withinDays`, most overdue first. */
export function dueSoon(vans: Van[], today: string, withinDays = 30): DueItem[] {
  const items: DueItem[] = [];
  for (const van of vans) {
    if (van.status !== "active") continue;
    for (const kind of DUE_KINDS) {
      const item = dueItem(van, kind, today);
      if (item && item.days <= withinDays) items.push(item);
    }
  }
  return items.sort((a, b) => a.days - b.days || a.van.reg.localeCompare(b.van.reg));
}

/** How many dates are still to be filled in, for each kind, across the active vans. */
export function missingDates(vans: Van[]): Record<DueKind, number> {
  const active = vans.filter((v) => v.status === "active");
  return { tax: active.filter((v) => !v.tax_due).length, doe: active.filter((v) => !v.doe_due).length, insurance: active.filter((v) => !v.insurance_due).length };
}

// ---- Warnings (same stages as the compliance register: 30, 14, 7 days and expired) ----

export type FleetAlert = { van: Van; kind: DueKind; days: number; stage: number; date: string };

export function pendingFleetAlerts(vans: Van[], today: string): FleetAlert[] {
  const alerts: FleetAlert[] = [];
  for (const van of vans) {
    if (van.status !== "active") continue;
    for (const kind of DUE_KINDS) {
      const date = van[dueField(kind)];
      if (!date) continue;
      const days = daysUntil(date, today);
      const stage = stageFor(days);
      if (stage > van[alertedField(kind)]) alerts.push({ van, kind, days, stage, date });
    }
  }
  return alerts.sort((a, b) => a.days - b.days);
}

export function fleetAlertMessage(alerts: FleetAlert[]): string {
  const lines = alerts.map((a) => `• ${a.van.reg}${a.van.driver ? ` (${a.van.driver})` : ""}: ${DUE_LABEL[a.kind]} ${describeDays(a.days)}, ${a.date}`);
  return `🚐 *Vans: ${alerts.length} date${alerts.length === 1 ? "" : "s"} need${alerts.length === 1 ? "s" : ""} attention*\n${lines.join("\n")}`;
}

/** The stage to record when a date is entered, so a date just typed in does not set off a warning at once. */
export const stageOnEntry = (date: string | null, today: string): number => (date ? stageFor(daysUntil(date, today)) : 0);
