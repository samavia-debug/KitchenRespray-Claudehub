import { describe, expect, it } from "vitest";
import { companyKeys, contactKeys, matchCompanies, matchContacts, type ExistingCompany, type ExistingContact } from "./duplicates";
import { cleanBulkChange, cleanCompanyInput, cleanCompanyQuery, cleanContactInput, cleanStageChange } from "./validate";

const ID = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";

function existing(over: Partial<ExistingCompany> & { id: string; name: string }): ExistingCompany {
  return { city: "Dublin", ...companyKeys({ name: over.name }), ...over };
}

describe("matchCompanies", () => {
  const ace = existing({ id: ID, name: "Ace Roofing Ltd", ...companyKeys({ name: "Ace Roofing Ltd", phone: "087 123 4567", website: "https://aceroofing.ie", email: "info@aceroofing.ie", address: "Unit 3 Industrial Estate", postcode: "D12" }) });

  it("flags the same phone number written differently as strong", () => {
    const m = matchCompanies(companyKeys({ name: "Something Else", phone: "+353 87 123 4567" }), [ace]);
    expect(m).toHaveLength(1);
    expect(m[0].strength).toBe("strong");
    expect(m[0].reasons).toContain("same phone number");
  });

  it("flags the same name with a different suffix, and the same website", () => {
    expect(matchCompanies(companyKeys({ name: "ACE ROOFING LIMITED" }), [ace])[0].reasons).toContain("same company name");
    expect(matchCompanies(companyKeys({ name: "Other", website: "www.aceroofing.ie/contact" }), [ace])[0].reasons).toContain("same website");
  });

  it("treats a shared email domain, address or contained name as only possible", () => {
    const byEmail = matchCompanies(companyKeys({ name: "Other", email: "sales@aceroofing.ie" }), [ace]);
    expect(byEmail[0].strength).toBe("possible");
    const byName = matchCompanies(companyKeys({ name: "Ace Roofing Dublin" }), [ace]);
    expect(byName[0].reasons).toEqual(["similar name"]);
    expect(byName[0].strength).toBe("possible");
  });

  it("does not match two companies that only share a free email provider", () => {
    const a = existing({ id: ID, name: "Joe Builders", ...companyKeys({ name: "Joe Builders", email: "joe@gmail.com" }) });
    expect(matchCompanies(companyKeys({ name: "Mary Joinery", email: "mary@gmail.com" }), [a])).toEqual([]);
  });

  it("does not match unrelated companies, and ignores the company being edited", () => {
    expect(matchCompanies(companyKeys({ name: "Zed Plumbing" }), [ace])).toEqual([]);
    expect(matchCompanies(ace, [ace], ID)).toEqual([]);
  });

  it("puts strong matches first", () => {
    const other = existing({ id: ID2, name: "Ace Roofing Leinster" });
    const m = matchCompanies(companyKeys({ name: "Ace Roofing", phone: "0871234567" }), [other, ace]);
    expect(m.map((x) => x.id)).toEqual([ID, ID2]);
  });
});

describe("matchContacts", () => {
  const joe: ExistingContact = { id: ID, full_name: "Joe Byrne", company_id: ID2, company_name: "Ace", ...contactKeys({ full_name: "Joe Byrne", email: "joe@ace.ie", phone: "087 111 2222" }) };

  it("flags the same email or phone anywhere", () => {
    expect(matchContacts(contactKeys({ full_name: "J. Byrne", email: "JOE@ace.ie" }), "other-company", [joe])[0].reasons).toEqual(["same email address"]);
    expect(matchContacts(contactKeys({ full_name: "Someone", phone: "+353 87 111 2222" }), "other-company", [joe])[0].reasons).toEqual(["same phone number"]);
  });

  it("flags the same name only at the same company", () => {
    expect(matchContacts(contactKeys({ full_name: "joe byrne" }), ID2, [joe])[0].reasons).toEqual(["same name at this company"]);
    expect(matchContacts(contactKeys({ full_name: "joe byrne" }), "different", [joe])).toEqual([]);
  });
});

describe("cleanCompanyInput", () => {
  it("requires a name for a new company and fills in the defaults", () => {
    expect("error" in cleanCompanyInput({})).toBe(true);
    expect("error" in cleanCompanyInput({ name: "   " })).toBe(true);
    const r = cleanCompanyInput({ name: "  Ace Roofing  " });
    expect("value" in r && r.value).toMatchObject({ name: "Ace Roofing", priority: "Medium", country: "Ireland" });
  });

  it("cleans every field and turns blanks into null", () => {
    const r = cleanCompanyInput({ name: "Ace", website: "aceroofing.ie", email: " INFO@Ace.IE ", phone: "+353 1 555 0100", city: "", estimated_value: "€12,500.555", next_follow_up: "2026-11-02", category_id: ID });
    expect("value" in r && r.value).toMatchObject({ website: "https://aceroofing.ie", email: "info@ace.ie", city: null, estimated_value: 12500.56, next_follow_up: "2026-11-02", category_id: ID });
  });

  it("rejects bad values with a clear message", () => {
    const bad = (o: object) => {
      const r = cleanCompanyInput({ name: "Ace", ...o });
      return "error" in r ? r.error : "";
    };
    expect(bad({ email: "nope" })).toMatch(/email/i);
    expect(bad({ phone: "abc" })).toMatch(/phone/i);
    expect(bad({ website: "not a site" })).toMatch(/web/i);
    expect(bad({ estimated_value: -5 })).toMatch(/amount/i);
    expect(bad({ estimated_value: "lots" })).toMatch(/amount/i);
    expect(bad({ priority: "Urgent" })).toMatch(/choices/i);
    expect(bad({ next_follow_up: "2026-02-31" })).toMatch(/date/i);
    expect(bad({ category_id: "x" })).toMatch(/not valid/i);
    expect(bad({ notes: "x".repeat(4001) })).toMatch(/too long/i);
    expect(bad({ name: 42 })).toMatch(/text/i);
  });

  it("returns only the fields sent for an update, so nothing else is wiped", () => {
    const r = cleanCompanyInput({ notes: "Called" }, true);
    expect("value" in r && r.value).toEqual({ notes: "Called" });
    expect("error" in cleanCompanyInput({ name: "" }, true)).toBe(true);
  });

  it("ignores fields it does not know, such as a forged id or archive flag", () => {
    const r = cleanCompanyInput({ name: "Ace", id: ID, archived_at: "2020-01-01", won_value: 99999, stage_id: ID });
    expect("value" in r && Object.keys(r.value).sort()).toEqual(["country", "name", "priority"]);
  });
});

describe("cleanContactInput", () => {
  it("needs a name and a company", () => {
    expect("error" in cleanContactInput({ company_id: ID })).toBe(true);
    expect("error" in cleanContactInput({ full_name: "Joe" })).toBe(true);
    const r = cleanContactInput({ company_id: ID, full_name: " Joe Byrne ", preferred_method: "WhatsApp", email: "" });
    expect("value" in r && r.value).toMatchObject({ company_id: ID, full_name: "Joe Byrne", preferred_method: "WhatsApp", email: null });
  });

  it("rejects an unknown contact method, and lets an update clear it", () => {
    expect("error" in cleanContactInput({ company_id: ID, full_name: "Joe", preferred_method: "Carrier pigeon" })).toBe(true);
    const r = cleanContactInput({ preferred_method: null }, true);
    expect("value" in r && r.value).toEqual({ preferred_method: null });
  });
});

describe("cleanStageChange and cleanBulkChange", () => {
  it("needs a stage and keeps the confirmation flag strict", () => {
    expect("error" in cleanStageChange({})).toBe(true);
    const r = cleanStageChange({ stage_id: ID, confirmed: "yes", won_value: "1,200", outcome_note: " Fitted " });
    expect("value" in r && r.value).toEqual({ stage_id: ID, confirmed: false, won_value: 1200, outcome_note: "Fitted" });
  });

  it("limits and validates a bulk change", () => {
    expect("error" in cleanBulkChange({ ids: [], action: "assign" })).toBe(true);
    expect("error" in cleanBulkChange({ ids: ["x"], action: "assign" })).toBe(true);
    expect("error" in cleanBulkChange({ ids: [ID], action: "delete" })).toBe(true);
    expect("error" in cleanBulkChange({ ids: Array(201).fill(ID), action: "assign" })).toBe(true);
    const r = cleanBulkChange({ ids: [ID, ID, ID2], action: "category", value: ID2, confirmed: true });
    expect("value" in r && r.value).toEqual({ ids: [ID, ID2], action: "category", value: ID2, confirmed: true });
  });
});

describe("cleanCompanyQuery", () => {
  it("falls back to safe defaults for anything odd", () => {
    const q = cleanCompanyQuery(new URLSearchParams("sort=password&dir=sideways&page=-3&pageSize=9999&priority=Urgent&category_id=zzz&follow_up_before=tomorrow"));
    expect(q).toMatchObject({ sort: "name", dir: "asc", page: 1, pageSize: 25, priority: null, category_id: null, follow_up_before: null });
  });

  it("reads real filters and cleans the search text", () => {
    const q = cleanCompanyQuery(new URLSearchParams(`q=ace,roofing)&category_id=${ID}&assigned_to=none&priority=High&sort=next_follow_up&dir=desc&page=3&pageSize=50&min_value=1000`));
    expect(q).toMatchObject({ q: "ace roofing", category_id: ID, assigned_to: "none", priority: "High", sort: "next_follow_up", dir: "desc", page: 3, pageSize: 50, min_value: 1000 });
  });
});
