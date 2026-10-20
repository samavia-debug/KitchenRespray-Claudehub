import { describe, expect, it } from "vitest";
import { companyKeys, matchCompanies, type ExistingCompany } from "./duplicates";
import { cleanCompanyInput } from "./validate";

const ID = "11111111-1111-4111-8111-111111111111";
const existing = (name: string, over: { phone?: string; mobile?: string }): ExistingCompany => ({ id: ID, name, city: "Dublin", ...companyKeys({ name, ...over }) });

describe("mobile numbers", () => {
  it("are cleaned like the main phone number", () => {
    const r = cleanCompanyInput({ name: "Ace", mobile: " 087 123 4567 " });
    expect("value" in r && r.value.mobile).toBe("087 123 4567");
    expect("error" in cleanCompanyInput({ name: "Ace", mobile: "call me" })).toBe(true);
    const blank = cleanCompanyInput({ name: "Ace", mobile: "" });
    expect("value" in blank && blank.value.mobile).toBeNull();
  });

  it("make a company a duplicate whichever column the number was typed in", () => {
    const known = existing("Ace Roofing", { phone: "01 555 0100", mobile: "087 123 4567" });
    // The same mobile typed as the main phone, and the same landline typed as the mobile.
    expect(matchCompanies(companyKeys({ name: "Other", phone: "+353 87 123 4567" }), [known])[0]?.reasons).toContain("same phone number");
    expect(matchCompanies(companyKeys({ name: "Other", mobile: "(01) 555 0100" }), [known])[0]?.reasons).toContain("same phone number");
    expect(matchCompanies(companyKeys({ name: "Other", mobile: "086 999 8888" }), [known])).toEqual([]);
  });
});
