/** The customer's contact details from a Microsoft Bookings appointment, cleaned and length-limited. */
export type CustomerDetails = { name: string | null; phone: string | null; note: string | null };

export type RawCustomerFields = {
  customerName?: string;
  customerPhone?: string;
  customerNotes?: string | null;
  customers?: { name?: string; phone?: string; notes?: string | null }[];
};

const LIMITS = { name: 120, phone: 40, note: 600 };

// Control characters and the odd stray symbol are dropped; line breaks in a note are kept.
const tidy = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max) : "";

/** Phone numbers keep digits and the usual punctuation only, so nothing else can ride along in that field. */
const tidyPhone = (value: unknown): string => tidy(value, LIMITS.phone).replace(/[^0-9+()\s.-]/g, "").replace(/\s+/g, " ").trim();

export function customerDetails(raw: RawCustomerFields): CustomerDetails {
  const first = raw.customers?.[0];
  const name = tidy(first?.name ?? raw.customerName, LIMITS.name).replace(/\s+/g, " ");
  const phone = tidyPhone(first?.phone ?? raw.customerPhone);
  const note = tidy(first?.notes ?? raw.customerNotes, LIMITS.note);
  return { name: name || null, phone: phone || null, note: note || null };
}

/** Customer text goes into an HTML note, so it is escaped: a name or note can never add markup or links of its own. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/**
 * The text shown inside the Connecteam shift: who is coming, their number, and anything they wrote
 * on the booking form. Undefined when there is nothing to show, so no empty note is created.
 */
export function notesHtml(d: CustomerDetails): string | undefined {
  const parts: string[] = [];
  if (d.name) parts.push(`<p><strong>Customer:</strong> ${escapeHtml(d.name)}</p>`);
  if (d.phone) parts.push(`<p><strong>Phone:</strong> ${escapeHtml(d.phone)}</p>`);
  if (d.note) parts.push(`<p><strong>Customer's note:</strong><br>${d.note.split(/\r?\n/).map(escapeHtml).join("<br>")}</p>`);
  return parts.length > 0 ? parts.join("") : undefined;
}
