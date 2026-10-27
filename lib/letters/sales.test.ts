import { describe, expect, it } from "vitest";
import mammoth from "mammoth";
import { LETTER_TYPES } from "./config";
import { canUseType, typesFor } from "./access";
import { buildDocx } from "./docx";
import { EMPTY_SETTINGS, renderLetter, type LetterContent } from "./layout";
import { EMPTY_QUOTE, addDays, cleanQuote, defaultTerms, euro, quoteTotals, renderQuote, type Quote } from "./quote";
import { buildFromStock, type StockContext } from "./stock";
import { categoryForType, starterTemplates } from "./templates";
import { cleanLetterInput, nextStatus } from "./validate";

const line = (description: string, qty: number, unit_price: number, vat_rate = 23) => ({ description, qty, unit_price, vat_rate });

describe("checking a quote", () => {
  const good = { valid_until: "2026-11-30", terms: "Valid 30 days.", lines: [{ description: " Respray 12 doors ", qty: "12", unit_price: "35.5", vat_rate: "13.5" }] };

  it("accepts a quote and tidies it", () => {
    expect(cleanQuote(good)).toEqual({ value: { number: "", valid_until: "2026-11-30", terms: "Valid 30 days.", lines: [line("Respray 12 doors", 12, 35.5, 13.5)] } });
  });

  it("drops a row left empty, but reports a half-filled one", () => {
    expect(cleanQuote({ lines: [{ description: "", qty: 1, unit_price: "" }, line("A", 1, 10)] })).toMatchObject({ value: { lines: [line("A", 1, 10)] } });
    expect(cleanQuote({ lines: [{ description: "", qty: 1, unit_price: 50 }] })).toEqual({ error: "Line 1 needs a description" });
  });

  it("says what is wrong, naming the line", () => {
    expect(cleanQuote({ lines: [line("A", 0, 10)] })).toEqual({ error: "Line 1: the quantity must be more than 0" });
    expect(cleanQuote({ lines: [line("A", 1, 10), { description: "B", qty: 1, unit_price: "lots", vat_rate: 23 }] })).toEqual({ error: "Line 2: enter the price in euro" });
    expect(cleanQuote({ lines: [line("A", 1, 10, 21)] })).toEqual({ error: "Line 1: choose a VAT rate from the list" });
    expect(cleanQuote({ valid_until: "soon", lines: [] })).toEqual({ error: "Enter a valid date for how long the quote is valid" });
    expect(cleanQuote({ lines: Array.from({ length: 61 }, () => line("A", 1, 1)) })).toEqual({ error: "A quote can have up to 60 lines" });
  });

  it("allows a discount as a negative price, and a missing quantity means one", () => {
    expect(cleanQuote({ lines: [{ description: "Discount", unit_price: -100, vat_rate: 23 }] })).toMatchObject({ value: { lines: [line("Discount", 1, -100)] } });
  });

  it("an empty or missing quote is an empty quote", () => {
    expect(cleanQuote(undefined)).toEqual({ value: EMPTY_QUOTE });
  });
});

describe("quote totals", () => {
  it("adds up exactly, in cents", () => {
    const t = quoteTotals([line("A", 2.5, 19.99), line("B", 3, 0.1)]);
    expect(t.lineNet).toEqual([4998, 30]); // 49.975 rounds up; 0.1 x 3 is exactly 0.30
    expect(t.subtotal).toBe(5028);
  });

  it("works VAT out on each rate's total, from the highest rate down", () => {
    const t = quoteTotals([line("Labour", 1, 1000, 13.5), line("Materials", 1, 400, 23), line("Extra labour", 1, 500, 13.5), line("Exempt", 1, 100, 0)]);
    expect(t.vat).toEqual([
      { rate: 23, net: 40000, vat: 9200 },
      { rate: 13.5, net: 150000, vat: 20250 },
      { rate: 0, net: 10000, vat: 0 },
    ]);
    expect(t.subtotal).toBe(200000);
    expect(t.vatTotal).toBe(29450);
    expect(t.total).toBe(229450);
  });

  it("takes a discount off before VAT", () => {
    const t = quoteTotals([line("Job", 1, 1000), line("Discount", 1, -100)]);
    expect(t.subtotal).toBe(90000);
    expect(t.vatTotal).toBe(20700);
    expect(t.total).toBe(110700);
  });

  it("no lines is nothing", () => {
    expect(quoteTotals([])).toEqual({ lineNet: [], subtotal: 0, vat: [], vatTotal: 0, total: 0 });
  });

  it("rounds a VAT amount to the nearest cent", () => {
    expect(quoteTotals([line("A", 1, 0.07, 13.5)]).vat[0].vat).toBe(1); // 0.00945 -> 0.01
    expect(quoteTotals([line("A", 1, 0.03, 13.5)]).vat[0].vat).toBe(0); // 0.00405 -> 0.00
  });
});

describe("showing money and dates", () => {
  it("formats euro with thousands separators and two decimals", () => {
    expect(euro(0)).toBe("€0.00");
    expect(euro(5)).toBe("€0.05");
    expect(euro(123456)).toBe("€1,234.56");
    expect(euro(100000000)).toBe("€1,000,000.00");
    expect(euro(-5000)).toBe("-€50.00");
  });

  it("adds days across a month and year end", () => {
    expect(addDays("2026-10-27", 30)).toBe("2026-11-26");
    expect(addDays("2026-12-15", 30)).toBe("2027-01-14");
  });

  it("the usual notes name the date and say nothing about payment or work", () => {
    const terms = defaultTerms("2026-11-26");
    expect(terms).toContain("This quote is valid until 26 November 2026.");
    expect(terms).not.toMatch(/deposit|pay|guarantee|warranty/i);
    expect(defaultTerms("")).not.toContain("valid until");
  });

  it("the quote as text has the same figures the totals give", () => {
    const quote: Quote = { number: "Q1001", valid_until: "2026-11-26", terms: "One.\n\nTwo.", lines: [line("Doors", 12, 35.5, 13.5), line("Paint", 1, 80, 23)] };
    const r = renderQuote(quote);
    expect(r.numberText).toBe("Quote number: Q1001");
    expect(r.validText).toBe("Valid until 26 November 2026");
    expect(r.rows[0]).toEqual({ description: "Doors", qty: "12", unit: "€35.50", vat: "13.5%", total: "€426.00" });
    expect(r.subtotal).toBe("€506.00");
    expect(r.vatRows).toEqual([
      { label: "VAT at 23% on €80.00", amount: "€18.40" },
      { label: "VAT at 13.5% on €426.00", amount: "€57.51" },
    ]);
    expect(r.total).toBe("€581.91");
    expect(r.terms).toEqual(["One.", "Two."]);
    expect(renderQuote(EMPTY_QUOTE).numberText).toContain("given when the quote is saved");
  });
});

describe("who may use which letters", () => {
  it("staff letters are Admin only; customer letters and quotes are open to Admin, Manager and Staff, never a Viewer", () => {
    for (const t of LETTER_TYPES.filter((x) => x.domain === "hr")) {
      expect(canUseType("Admin", t.key)).toBe(true);
      expect(canUseType("Manager", t.key)).toBe(false);
      expect(canUseType("Staff", t.key)).toBe(false);
    }
    for (const key of ["sales_letter", "quote"]) {
      for (const role of ["Admin", "Manager", "Staff"] as const) expect(canUseType(role, key)).toBe(true);
      expect(canUseType("Viewer", key)).toBe(false);
    }
  });

  it("an unknown kind is treated as a staff letter, and nobody signed out can use anything", () => {
    expect(canUseType("Manager", "made_up")).toBe(false);
    expect(canUseType("Admin", "made_up")).toBe(true);
    expect(canUseType(null, "quote")).toBe(false);
    expect(canUseType(undefined, "quote")).toBe(false);
  });

  it("a Manager's list holds only the customer kinds", () => {
    expect(typesFor("Manager").sort()).toEqual(["quote", "sales_letter"]);
    expect(typesFor("Viewer")).toEqual([]);
  });
});

describe("saving a customer letter or quote", () => {
  const base = { letter_type: "quote", letter_date: "2026-10-27", recipient: { name: "Mr Murphy", organisation: "Murphy Builders" }, subject: "Quote: kitchen", greeting: "Dear Mr Murphy,", body: "", closing: "Yours sincerely,", quote: { valid_until: "2026-11-26", lines: [line("Doors", 12, 35.5, 13.5)] } };

  it("needs a customer but not a staff member, and is kept under the customer's name", () => {
    const r = cleanLetterInput(base);
    if (!("value" in r)) throw new Error(r.error);
    expect(r.value).toMatchObject({ technician_user_id: null, technician_name: "Mr Murphy", technician_former: false, letter_type: "quote" });
    expect(r.value.quote.lines).toHaveLength(1);
  });

  it("ignores a staff member sent along with a customer letter", () => {
    const r = cleanLetterInput({ ...base, letter_type: "sales_letter", technician_user_id: 7, technician_name: "Pat", technician_former: true });
    if (!("value" in r)) throw new Error(r.error);
    expect(r.value).toMatchObject({ technician_user_id: null, technician_name: "Mr Murphy", technician_former: false });
    expect(r.value.quote).toEqual(EMPTY_QUOTE); // only a quote has lines
  });

  it("asks who it is for when there is no customer name or organisation", () => {
    expect(cleanLetterInput({ ...base, recipient: {} })).toEqual({ error: "Enter who the letter is for" });
    expect(cleanLetterInput({ ...base, recipient: { organisation: "Murphy Builders" } })).toMatchObject({ value: { technician_name: "Murphy Builders" } });
  });

  it("a letter about staff still needs the staff member", () => {
    expect(cleanLetterInput({ ...base, letter_type: "work_assignment", technician_name: "" })).toEqual({ error: "Choose a technician" });
  });

  it("reports a problem in the quote's lines", () => {
    expect(cleanLetterInput({ ...base, quote: { lines: [line("A", 0, 1)] } })).toEqual({ error: "Line 1: the quantity must be more than 0" });
  });
});

describe("finalising a quote", () => {
  const quote = (lines: Quote["lines"]): Quote => ({ ...EMPTY_QUOTE, lines });

  it("needs at least one line, and then needs no note above it", () => {
    expect(nextStatus("draft", "finalise", { subject: "Quote", body: "", letter_type: "quote", quote: quote([]) })).toEqual({ ok: false, error: "Add at least one line to the quote before finalising" });
    expect(nextStatus("draft", "finalise", { subject: "Quote", body: "", letter_type: "quote", quote: quote([line("A", 1, 1)]) })).toEqual({ ok: true, status: "finalised" });
  });

  it("other letters still need their text", () => {
    expect(nextStatus("draft", "finalise", { subject: "S", body: "", letter_type: "sales_letter" })).toEqual({ ok: false, error: "The letter has no text yet" });
  });
});

const ctx = (recipient: string, purpose: string): StockContext => ({
  facts: { name: recipient, former: false, values: {}, sources: {} },
  company: "Kitchen Respray",
  recipient: { name: recipient },
  details: { purpose },
});

describe("writing a customer letter or quote from the ready-made wording", () => {
  it("a quote gets a subject and a short note", () => {
    const d = buildFromStock("quote", ctx("Mr Murphy", "respraying your kitchen doors"));
    expect(d.subject).toBe("Quote: respraying your kitchen doors");
    expect(d.body).toBe("Thank you for the opportunity to quote for respraying your kitchen doors. Our quote is set out below.");
    expect(d.greeting).toBe("Dear Mr Murphy,");
    expect(d.missing).toEqual([]);
  });

  it("a customer letter says what it is about and offers to answer questions", () => {
    const d = buildFromStock("sales_letter", ctx("Ms Byrne", "your enquiry"));
    expect(d.body).toContain("Thank you for contacting Kitchen Respray. I am writing about your enquiry.");
    expect(d.body).toContain("If you have any questions");
    expect(d.subject).toBe("");
    expect(d.missing).toContain("Add a subject line");
  });

  it("marks what is not known instead of guessing", () => {
    expect(buildFromStock("quote", ctx("Mr Murphy", "")).body).toContain("[CONFIRM: the details for this letter]");
  });
});

describe("templates for customer documents", () => {
  it("start in their own categories, and there is a starter for each", () => {
    expect(categoryForType("quote")).toBe("quote");
    expect(categoryForType("sales_letter")).toBe("sales");
    expect(categoryForType("warning")).toBe("hr");
    expect(categoryForType("custom")).toBe("general");
    const starters = starterTemplates();
    expect(starters.find((s) => s.letter_type === "quote")?.category).toBe("quote");
    expect(starters.find((s) => s.letter_type === "sales_letter")?.category).toBe("sales");
  });
});

describe("a quote in the letter and the Word file", () => {
  const quote: Quote = { number: "Q1001", valid_until: "2026-11-26", terms: "Valid for 30 days.", lines: [line("Respray 12 kitchen doors", 12, 35.5, 13.5), line("Paint and materials", 1, 80, 23)] };
  const letter: LetterContent = {
    letter_type: "quote",
    status: "finalised",
    letter_date: "2026-10-27",
    subject: "Quote: kitchen doors",
    recipient: { name: "Mr Murphy", address: "1 Main Street" },
    greeting: "Dear Mr Murphy,",
    body: "Thank you for the opportunity to quote.",
    closing: "Yours sincerely,",
    quote,
  };

  it("is laid out with its table and totals only for a quote", () => {
    expect(renderLetter(EMPTY_SETTINGS, letter).quote?.total).toBe("€581.91");
    expect(renderLetter(EMPTY_SETTINGS, { ...letter, letter_type: "sales_letter" }).quote).toBeNull();
    expect(renderLetter(EMPTY_SETTINGS, { ...letter, quote: undefined }).quote?.rows).toEqual([]);
    expect(renderLetter(EMPTY_SETTINGS, { ...letter, quote: {} }).quote?.rows).toEqual([]);
  });

  it("goes into Word as a real table, with the same figures, between the note and the closing", async () => {
    const doc = buildDocx(renderLetter(EMPTY_SETTINGS, letter), new Date("2026-10-27T10:00:00Z"));
    const xml = doc.toString("latin1");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:tblHeader/>");

    const { value } = await mammoth.extractRawText({ buffer: doc });
    for (const text of ["Quote number: Q1001", "Valid until 26 November 2026", "Respray 12 kitchen doors", "€426.00", "Subtotal", "€506.00", "VAT at 13.5% on €426.00", "€57.51", "Total", "€581.91", "Valid for 30 days."]) {
      expect(value, text).toContain(text);
    }
    expect(value.indexOf("Thank you for the opportunity")).toBeLessThan(value.indexOf("Respray 12 kitchen doors"));
    expect(value.indexOf("€581.91")).toBeLessThan(value.indexOf("Yours sincerely,"));
  });

  it("a letter that is not a quote has no table", () => {
    const doc = buildDocx(renderLetter(EMPTY_SETTINGS, { ...letter, letter_type: "sales_letter" }));
    expect(doc.toString("latin1")).not.toContain("<w:tbl>");
  });
});
