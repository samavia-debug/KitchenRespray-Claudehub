import { validIsoDate } from "../compliance/extract";
import { formatLongDate } from "./facts";

// A quote: lines with a quantity, a price and a VAT rate, the totals, and how long it is valid for. Amounts are worked out in
// whole cents so the totals add up exactly. The VAT rates offered are the usual Irish ones; which one applies to a line is for
// whoever writes the quote (and the financial controller) to decide, so nothing here picks one for a particular kind of work.

export const VAT_RATES = [23, 13.5, 9, 0] as const;
export const DEFAULT_VAT_RATE = 23;

export type QuoteLine = { description: string; qty: number; unit_price: number; vat_rate: number };
export type Quote = {
  /** Given when the quote is first saved, never typed. */
  number: string;
  valid_until: string;
  terms: string;
  lines: QuoteLine[];
};

export const EMPTY_QUOTE: Quote = { number: "", valid_until: "", terms: "", lines: [] };

const MAX_LINES = 60;
const MAX_AMOUNT = 10_000_000;
const MAX_QTY = 100_000;

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "");
const oneLine = (v: unknown, max: number) => text(v, max).replace(/\s+/g, " ");

const toNumber = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/,/g, "")) : NaN);
const cents = (n: number) => Math.round(n * 100 + (n >= 0 ? 1e-9 : -1e-9));

/** Checks the quote the page sends. A row left empty is dropped; anything else that is not right is reported. */
export function cleanQuote(raw: unknown): { value: Quote } | { error: string } {
  const q = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const rawLines = Array.isArray(q.lines) ? q.lines : [];
  if (rawLines.length > MAX_LINES) return { error: `A quote can have up to ${MAX_LINES} lines` };

  const lines: QuoteLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = (rawLines[i] && typeof rawLines[i] === "object" ? rawLines[i] : {}) as Record<string, unknown>;
    const description = oneLine(l.description, 300);
    const price = toNumber(l.unit_price);
    const empty = !description && (l.unit_price === "" || l.unit_price === null || l.unit_price === undefined || price === 0);
    if (empty) continue;

    const where = `Line ${lines.length + 1}`;
    if (!description) return { error: `${where} needs a description` };
    const qty = toNumber(l.qty === "" || l.qty === undefined || l.qty === null ? 1 : l.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > MAX_QTY) return { error: `${where}: the quantity must be more than 0` };
    if (!Number.isFinite(price) || Math.abs(price) > MAX_AMOUNT) return { error: `${where}: enter the price in euro` };
    const vat = toNumber(l.vat_rate ?? DEFAULT_VAT_RATE);
    if (!(VAT_RATES as readonly number[]).includes(vat)) return { error: `${where}: choose a VAT rate from the list` };
    lines.push({ description, qty: Math.round(qty * 100) / 100, unit_price: Math.round(price * 100) / 100, vat_rate: vat });
  }

  const validRaw = typeof q.valid_until === "string" ? q.valid_until.trim() : "";
  const valid = validRaw ? validIsoDate(validRaw) : "";
  if (validRaw && !valid) return { error: "Enter a valid date for how long the quote is valid" };

  return { value: { number: oneLine(q.number, 40), valid_until: valid || "", terms: text(q.terms, 1500), lines } };
}

// ---- Totals ----

export type VatRow = { rate: number; net: number; vat: number };
export type QuoteTotals = { lineNet: number[]; subtotal: number; vat: VatRow[]; vatTotal: number; total: number };

/** All in cents. VAT is worked out on the total of each rate, not line by line, so it matches how it is shown on the quote. */
export function quoteTotals(lines: QuoteLine[]): QuoteTotals {
  const lineNet = lines.map((l) => Math.round(l.qty * cents(l.unit_price) + (l.qty * cents(l.unit_price) >= 0 ? 1e-9 : -1e-9)));
  const byRate = new Map<number, number>();
  lines.forEach((l, i) => byRate.set(l.vat_rate, (byRate.get(l.vat_rate) ?? 0) + lineNet[i]));
  const vat = Array.from(byRate.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([rate, net]) => ({ rate, net, vat: Math.round((net * Math.round(rate * 10)) / 1000) }));
  const subtotal = lineNet.reduce((t, n) => t + n, 0);
  const vatTotal = vat.reduce((t, r) => t + r.vat, 0);
  return { lineNet, subtotal, vat, vatTotal, total: subtotal + vatTotal };
}

/** 123456 as "€1,234.56". */
export function euro(centsValue: number): string {
  const abs = Math.abs(Math.round(centsValue));
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${centsValue < 0 ? "-" : ""}€${whole}.${String(abs % 100).padStart(2, "0")}`;
}

export const qtyText = (qty: number): string => String(Math.round(qty * 100) / 100);
export const vatText = (rate: number): string => `${rate}%`;

// ---- Defaults ----

/** `days` after `today` (both YYYY-MM-DD). */
export function addDays(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The usual notes under a quote, for the person to keep or change. Says nothing about payment or work, which are the company's to set. */
export function defaultTerms(validUntil: string): string {
  const lines = [];
  if (validUntil) lines.push(`This quote is valid until ${formatLongDate(validUntil)}.`);
  lines.push("Prices are in euro, with VAT shown at the rate for each line.");
  lines.push("To accept this quote, please reply and we will agree the next steps with you.");
  return lines.join("\n");
}

// ---- Ready to lay out ----

export type RenderedQuote = {
  numberText: string;
  validText: string | null;
  rows: { description: string; qty: string; unit: string; vat: string; total: string }[];
  subtotal: string;
  vatRows: { label: string; amount: string }[];
  total: string;
  terms: string[];
};

/** The quote as text for the preview, the print and the Word file, so all three show exactly the same figures. */
export function renderQuote(q: Quote): RenderedQuote {
  const t = quoteTotals(q.lines);
  return {
    numberText: q.number ? `Quote number: ${q.number}` : "Quote number: given when the quote is saved",
    validText: q.valid_until ? `Valid until ${formatLongDate(q.valid_until)}` : null,
    rows: q.lines.map((l, i) => ({ description: l.description, qty: qtyText(l.qty), unit: euro(cents(l.unit_price)), vat: vatText(l.vat_rate), total: euro(t.lineNet[i]) })),
    subtotal: euro(t.subtotal),
    vatRows: t.vat.map((r) => ({ label: `VAT at ${vatText(r.rate)} on ${euro(r.net)}`, amount: euro(r.vat) })),
    total: euro(t.total),
    terms: q.terms.split(/\n/).map((l) => l.trim()).filter(Boolean),
  };
}
