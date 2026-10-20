import { describe, expect, it } from "vitest";
import { companyKeys, type ExistingCompany } from "../duplicates";
import type { Category } from "../types";
import { buildRow, NO_DEFAULTS } from "./mapping";
import { actionFor, CompanyIndex, countPlan, planImport } from "./plan";

const categories: Category[] = [];
const HEADERS = ["Company", "Website", "Email", "Phone", "Mobile", "Address", "Contact", "Contact email"];
const TARGETS = ["name", "website", "email", "phone", "mobile", "address", "contact_name", "contact_email"];

const row = (name: string, o: Partial<Record<"website" | "email" | "phone" | "mobile" | "address" | "contact" | "contactEmail", string>> = {}) =>
  buildRow([name, o.website ?? "", o.email ?? "", o.phone ?? "", o.mobile ?? "", o.address ?? "", o.contact ?? "", o.contactEmail ?? ""], HEADERS, TARGETS, { categories, defaults: NO_DEFAULTS });

const existing = (id: string, name: string, over: Record<string, string> = {}): ExistingCompany => ({ id, name, city: "Dublin", ...companyKeys({ name, ...over }) });

describe("CompanyIndex", () => {
  it("finds companies that share a key, and only those", () => {
    const index = new CompanyIndex();
    const ace = existing("1", "Ace Roofing", { phone: "01 555 0100" });
    const beta = existing("2", "Beta Builders", { website: "https://beta.ie" });
    index.add(ace);
    index.add(beta);
    expect(index.candidates(companyKeys({ name: "Someone", phone: "+353 1 555 0100" }))).toEqual([ace]);
    expect(index.candidates(companyKeys({ name: "Other", website: "www.beta.ie" }))).toEqual([beta]);
    expect(index.candidates(companyKeys({ name: "Ace Roofing Dublin" }))).toEqual([ace]);
    expect(index.candidates(companyKeys({ name: "Zed", phone: "086 000 0000" }))).toEqual([]);
  });

  it("finds a company by its mobile number", () => {
    const index = new CompanyIndex();
    const ace = existing("1", "Ace", { mobile: "087 123 4567" });
    index.add(ace);
    expect(index.candidates(companyKeys({ name: "Other", phone: "087 123 4567" }))).toEqual([ace]);
  });
});

describe("planImport", () => {
  it("marks a clean row ready, and a row with no name as an error that is never imported", () => {
    const plan = planImport([row("Ace Roofing"), row("")], [], []);
    expect(plan[0]).toMatchObject({ status: "ready", defaultAction: "import", matches: [], fileMatches: [] });
    expect(plan[1]).toMatchObject({ status: "error", defaultAction: "skip", errors: ["There is no company name"] });
    expect(actionFor(plan[1], { 1: "import" })).toBe("skip");
  });

  it("skips by default a company that shares a phone number with one already in the CRM", () => {
    const plan = planImport([row("Different Name", { phone: "087 111 2222" })], [existing("c1", "Ace Roofing", { phone: "+353 87 111 2222" })], []);
    expect(plan[0]).toMatchObject({ status: "duplicate", defaultAction: "skip" });
    expect(plan[0].matches[0]).toMatchObject({ id: "c1", strength: "strong", reasons: ["same phone number"] });
  });

  it("only flags a possible look-alike, and imports it unless the person says otherwise", () => {
    const plan = planImport([row("Ace Roofing Dublin")], [existing("c1", "Ace Roofing")], []);
    expect(plan[0]).toMatchObject({ status: "duplicate", defaultAction: "import" });
    expect(plan[0].matches[0].strength).toBe("possible");
    expect(actionFor(plan[0], { 0: "skip" })).toBe("skip");
  });

  it("catches duplicates inside the file, pointing at the earlier row", () => {
    const plan = planImport([row("Ace Roofing", { phone: "087 123 4567" }), row("Beta"), row("ACE ROOFING LTD", { website: "ace.ie" })], [], []);
    expect(plan[0].status).toBe("ready");
    expect(plan[2]).toMatchObject({ status: "duplicate", defaultAction: "skip" });
    expect(plan[2].fileMatches[0]).toMatchObject({ row: 0, label: "Ace Roofing", strength: "strong" });
  });

  it("does not count a row with an error as something later rows can duplicate", () => {
    const plan = planImport([row("", { phone: "087 123 4567" }), row("Ace", { phone: "087 123 4567" })], [], []);
    expect(plan[1].status).toBe("ready");
  });

  it("does not treat two companies with only a free email provider in common as duplicates", () => {
    const plan = planImport([row("Joe Builders", { email: "joe@gmail.com" }), row("Mary Joinery", { email: "mary@gmail.com" })], [], []);
    expect(plan.map((p) => p.status)).toEqual(["ready", "ready"]);
  });

  it("notes a contact that is already in the CRM, or repeated in the file, without blocking the company", () => {
    const plan = planImport(
      [row("Ace", { contact: "Mick", contactEmail: "mick@ace.ie" }), row("Beta", { contact: "Mick B", contactEmail: "MICK@ace.ie" }), row("Cork", { contact: "Mary", contactEmail: "mary@cork.ie" })],
      [],
      [{ email_key: "mary@cork.ie", phone_key: null }]
    );
    expect(plan[0].contactNote).toBeNull();
    expect(plan[1].contactNote).toMatch(/already in the CRM/);
    expect(plan[2].contactNote).toMatch(/already in the CRM/);
    expect(plan.map((p) => p.status)).toEqual(["ready", "ready", "ready"]);
  });

  it("copes with several thousand rows against a large CRM in good time", () => {
    const crm = Array.from({ length: 8000 }, (_, i) => existing(`c${i}`, `Company ${i} ${["Roofing", "Builders", "Joinery"][i % 3]}`, { phone: `01 ${String(1000000 + i)}` }));
    const rows = Array.from({ length: 3000 }, (_, i) => row(`New Firm ${i} Fitters`, { phone: `086 ${String(2000000 + i)}` }));
    const started = Date.now();
    const plan = planImport(rows, crm, []);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(plan.every((p) => p.status === "ready")).toBe(true);
  });
});

describe("countPlan", () => {
  it("counts what would happen with the person's choices", () => {
    const plan = planImport([row("Ace", { phone: "087 123 4567" }), row("Ace Again", { phone: "087 123 4567" }), row(""), row("Beta")], [], []);
    expect(countPlan(plan)).toEqual({ total: 4, ready: 2, duplicates: 1, errors: 1, withWarnings: 0, willImport: 2, willSkip: 2 });
    // Choosing to import the duplicate, and to skip a ready row; an error cannot be forced in.
    expect(countPlan(plan, { 1: "import", 3: "skip", 2: "import" })).toMatchObject({ willImport: 2, willSkip: 2 });
  });
});
