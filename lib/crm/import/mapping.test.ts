import { describe, expect, it } from "vitest";
import type { Category } from "../types";
import { autoMap, buildRow, IMPORT_TARGETS, NO_DEFAULTS, validateMapping } from "./mapping";

const categories: Category[] = [
  { id: "cat-builders", name: "Builders", sort_order: 1, active: true },
  { id: "cat-carp", name: "Carpenters and Joiners", sort_order: 2, active: true },
  { id: "cat-old", name: "Old Category", sort_order: 3, active: false },
];
const ctx = (defaults = NO_DEFAULTS) => ({ categories, defaults });

// The headings of the two Dublin lead lists.
const BUILDERS = ["Company Name", "Company Website", "Public Business Email", "Contact Phone Number", "Business Address", "City", "County", "Google Maps Listing", "Google Rating", "Google Review Count", "Primary Services", "AI-Generated Business Summary"];
const CARPENTRY = ["Company Name", "Website", "Email", "Phone", "Mobile", "Google Maps", "Address", "City", "County", "Postal Code", "Country", "Google Rating", "Reviews", "Services / Category", "Source"];

describe("autoMap", () => {
  it("recognises the headings of the builders lead list", () => {
    expect(autoMap(BUILDERS)).toEqual(["name", "website", "email", "phone", "address", "city", "county", "extra", "extra", "extra", "services", "extra"]);
  });

  it("recognises the headings of the carpentry lead list, including the separate mobile", () => {
    expect(autoMap(CARPENTRY)).toEqual(["name", "website", "email", "phone", "mobile", "extra", "address", "city", "county", "postcode", "country", "extra", "extra", "services", "source"]);
  });

  it("suggests each field once, and ignores what it does not know", () => {
    expect(autoMap(["Name", "Company", "Phone", "Telephone", "Favourite colour"])).toEqual(["name", "ignore", "phone", "ignore", "ignore"]);
  });
});

describe("validateMapping", () => {
  it("needs a company name column and a matching length", () => {
    expect(validateMapping(["phone", "email"], 2)).toMatch(/company name/i);
    expect(validateMapping(["name"], 2)).toMatch(/do not match/i);
    expect(validateMapping("name", 1)).toMatch(/do not match/i);
    expect(validateMapping(["name", "phone"], 2)).toBeNull();
  });

  it("will not let two columns fill the same field, but allows several extras", () => {
    expect(validateMapping(["name", "phone", "phone"], 3)).toMatch(/more than one/i);
    expect(validateMapping(["name", "extra", "extra", "ignore", "ignore"], 5)).toBeNull();
  });

  it("rejects a target it does not know", () => {
    expect(validateMapping(["name", "password"], 2)).toMatch(/not recognised/i);
    expect(validateMapping(["name", 5], 2)).toMatch(/not recognised/i);
  });

  it("offers a way to map every CRM field the import can fill", () => {
    const ids = IMPORT_TARGETS.map((t) => t.id);
    for (const id of ["name", "mobile", "category", "contact_name", "extra", "ignore"]) expect(ids).toContain(id);
  });
});

describe("buildRow", () => {
  const headers = ["Company", "Website", "Email", "Phone", "Mobile", "City", "Rating", "Summary"];
  const targets = ["name", "website", "email", "phone", "mobile", "city", "extra", "extra"];

  it("builds a clean company and keeps the extra columns as details", () => {
    const r = buildRow(["  Ace Roofing  ", "aceroofing.ie", "INFO@Ace.ie", "+353 1 555 0100", "087 123 4567", "Dublin", "4.5", "A roofing firm."], headers, targets, ctx());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.company).toMatchObject({ name: "Ace Roofing", website: "https://aceroofing.ie", email: "info@ace.ie", phone: "+353 1 555 0100", mobile: "087 123 4567", city: "Dublin" });
    expect(r.extra).toEqual({ Rating: "4.5", Summary: "A roofing firm." });
  });

  it("refuses a row with no company name, and says why", () => {
    const r = buildRow(["", "ace.ie", "", "", "", "", "", ""], headers, targets, ctx());
    expect(r.company).toBeNull();
    expect(r.errors).toEqual(["There is no company name"]);
    expect(buildRow(["x".repeat(201), "", "", "", "", "", "", ""], headers, targets, ctx()).errors[0]).toMatch(/too long/);
  });

  it("leaves out an invalid detail with a warning, and keeps the original text so nothing is lost", () => {
    const r = buildRow(["Ace", "not a site", "nope", "call us", "", "Dublin", "", ""], headers, targets, ctx());
    expect(r.company).toMatchObject({ name: "Ace", city: "Dublin" });
    expect(r.company).not.toHaveProperty("website");
    expect(r.company).not.toHaveProperty("email");
    expect(r.company).not.toHaveProperty("phone");
    expect(r.warnings).toHaveLength(3);
    expect(r.extra).toEqual({ "Not imported: Website": "not a site", "Not imported: Email": "nope", "Not imported: Telephone": "call us" });
  });

  it("matches a category by name, falls back to the default, and warns about an unknown one", () => {
    const h = ["Name", "Type"];
    const t = ["name", "category"];
    expect(buildRow(["Ace", " builders "], h, t, ctx()).company?.category_id).toBe("cat-builders");
    const unknown = buildRow(["Ace", "Roofers"], h, t, ctx({ ...NO_DEFAULTS, category_id: "cat-carp" }));
    expect(unknown.company?.category_id).toBe("cat-carp");
    expect(unknown.warnings[0]).toMatch(/not one of your categories/);
    expect(unknown.extra["Category in file"]).toBe("Roofers");
    // A switched-off category is not matched.
    expect(buildRow(["Ace", "Old Category"], h, t, ctx()).company?.category_id).toBeNull();
  });

  it("applies the defaults only where the row has nothing", () => {
    const defaults = { category_id: "cat-builders", source: "Google Maps list", assigned_to: "user-1", priority: "High" as const };
    const h = ["Name", "Source", "Priority"];
    const t = ["name", "source", "priority"];
    const blank = buildRow(["Ace", "", ""], h, t, ctx(defaults));
    expect(blank.company).toMatchObject({ category_id: "cat-builders", source: "Google Maps list", assigned_to: "user-1", priority: "High" });
    const own = buildRow(["Ace", "Referral", "low"], h, t, ctx(defaults));
    expect(own.company).toMatchObject({ source: "Referral", priority: "Low" });
    expect(buildRow(["Ace", "", "urgent"], h, t, ctx()).warnings[0]).toMatch(/High, Medium or Low/);
  });

  it("reads the estimated value in the usual ways", () => {
    const h = ["Name", "Value"];
    const t = ["name", "estimated_value"];
    expect(buildRow(["Ace", "€12,500"], h, t, ctx()).company?.estimated_value).toBe(12500);
    expect(buildRow(["Ace", "lots"], h, t, ctx()).warnings[0]).toMatch(/Estimated value/);
  });

  it("adds a contact when there is a contact name, and warns when details come without one", () => {
    const h = ["Name", "Contact", "Title", "Contact email", "Contact phone"];
    const t = ["name", "contact_name", "contact_job_title", "contact_email", "contact_phone"];
    const r = buildRow(["Ace", "Mick Doyle", "Manager", "MICK@ace.ie", "087 111 2222"], h, t, ctx());
    expect(r.contact).toEqual({ full_name: "Mick Doyle", job_title: "Manager", email: "mick@ace.ie", phone: "087 111 2222" });
    const noName = buildRow(["Ace", "", "Manager", "", ""], h, t, ctx());
    expect(noName.contact).toBeNull();
    expect(noName.warnings[0]).toMatch(/no contact name/);
    const badEmail = buildRow(["Ace", "Mick", "", "nope", ""], h, t, ctx());
    expect(badEmail.contact).toEqual({ full_name: "Mick" });
    expect(badEmail.extra["Not imported: Contact email"]).toBe("nope");
  });

  it("limits how many extra details one company keeps, and how long each is", () => {
    const headers2 = Array.from({ length: 40 }, (_, i) => `H${i}`);
    const r = buildRow(["Ace", ...Array(39).fill("v")], headers2, ["name", ...Array(39).fill("extra")], ctx());
    expect(Object.keys(r.extra)).toHaveLength(30);
    const long = buildRow(["Ace", "y".repeat(5000)], ["Name", "Summary"], ["name", "extra"], ctx());
    expect(long.extra.Summary).toHaveLength(2000);
  });

  it("does not pass a spreadsheet formula through as anything but text", () => {
    const r = buildRow(["=HYPERLINK(\"http://evil\",\"x\")", "", "", "", "", "", "", ""], headers, targets, ctx());
    expect(r.company?.name).toBe('=HYPERLINK("http://evil","x")');
  });
});
