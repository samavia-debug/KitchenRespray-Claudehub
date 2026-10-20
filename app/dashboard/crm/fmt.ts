const dateFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const moneyFmt = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const moneyFmtCents = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });

export const fmtDate = (v: string | null | undefined) => (v ? dateFmt.format(new Date(v.length === 10 ? `${v}T12:00:00Z` : v)) : "—");
export const fmtDateTime = (v: string | null | undefined) => (v ? dateTimeFmt.format(new Date(v)) : "—");
export const fmtMoney = (v: number | null | undefined) => (v === null || v === undefined ? "—" : Number.isInteger(Number(v)) ? moneyFmt.format(Number(v)) : moneyFmtCents.format(Number(v)));

export { personName } from "@/lib/crm/names";

/**
 * A link that opens a WhatsApp chat with this number (nothing is sent: the person writes and sends the message).
 * Irish numbers written with a leading 0 get +353; anything already in international form is kept as it is.
 * Landlines get no link.
 */
export function whatsappLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  let digits = text.replace(/\(0\)/g, "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (!text.startsWith("+")) {
    if (!digits.startsWith("0")) return null;
    digits = `353${digits.slice(1)}`;
  }
  // An Irish landline (01, 021, 044...) cannot have WhatsApp: Irish mobiles are 083 to 089, so after 353 they start with 8.
  if (digits.startsWith("353") && !/^3538\d{8}$/.test(digits)) return null;
  return digits.length >= 9 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

/** Today in Dublin as YYYY-MM-DD, for "is this follow-up overdue". */
export function todayDublin(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p;
}

export type FollowUpState = "overdue" | "today" | "upcoming" | "none";
export function followUpState(date: string | null | undefined): FollowUpState {
  if (!date) return "none";
  const today = todayDublin();
  return date < today ? "overdue" : date === today ? "today" : "upcoming";
}

export const FOLLOW_UP_COLOR: Record<FollowUpState, string | undefined> = { overdue: "#b3261e", today: "#b98900", upcoming: undefined, none: "var(--muted)" };

export const PRIORITY_COLOR: Record<string, string> = { High: "#b3261e", Medium: "#b98900", Low: "#5b6b7c" };

export const STAGE_COLOR: Record<string, { bg: string; fg: string }> = {
  open: { bg: "rgba(60, 90, 160, 0.12)", fg: "#2f4a86" },
  won: { bg: "rgba(46, 125, 50, 0.14)", fg: "#2e7d32" },
  lost: { bg: "rgba(179, 38, 30, 0.12)", fg: "#b3261e" },
  not_suitable: { bg: "rgba(110, 110, 110, 0.14)", fg: "#5f5f5f" },
};
