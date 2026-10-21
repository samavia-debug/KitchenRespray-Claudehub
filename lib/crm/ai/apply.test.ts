import { describe, expect, it } from "vitest";
import { detailPatch, researchPatch, type SuggestionToApply } from "./apply";

const blank = { category_id: null, services: null, description: null, notes: null, email: null, phone: null, mobile: null };
const WHO = "Joanna Byrne";
const DATE = "21 Oct 2026";
const s = (field: SuggestionToApply["field"], value: string, extra: Partial<SuggestionToApply> = {}): SuggestionToApply => ({ field, value, source: "website", ...extra });

describe("saving research suggestions", () => {
  it("fills in what is empty and adds one note saying where it came from", () => {
    const patch = researchPatch(blank, [s("category", "Carpenters and Joiners", { category_id: "cat1" }), s("services", "Bespoke staircases"), s("description", "A family joinery business in Carlow.")], WHO, DATE);
    expect(patch).toMatchObject({ category_id: "cat1", services: "Bespoke staircases", description: "A family joinery business in Carlow." });
    expect(patch.notes).toBe("AI-assisted (21 Oct 2026, Joanna Byrne): Category, Potential services, Business description from website, unverified.");
  });

  it("adds to what is already there and never replaces it", () => {
    const current = { ...blank, services: "Kitchens", description: "Old description", notes: "Rang once, no answer" };
    const patch = researchPatch(current, [s("services", "Staircases"), s("description", "New line"), s("notes", "Two brands")], WHO, DATE);
    expect(patch.services).toBe("Kitchens; Staircases");
    expect(patch.description).toBe("Old description\nNew line");
    expect(String(patch.notes).startsWith("Rang once, no answer\nTwo brands\nAI-assisted")).toBe(true);
  });

  it("leaves a field out of the change when no suggestion touches it", () => {
    const patch = researchPatch({ ...blank, services: "Kitchens" }, [s("priority", "High")], WHO, DATE);
    expect(Object.keys(patch).sort()).toEqual(["notes", "priority"]);
    expect(patch.priority).toBe("High");
  });

  it("names each kind of change and each source once", () => {
    const patch = researchPatch(blank, [s("notes", "a"), s("notes", "b"), s("services", "c", { source: "record" }), s("description", "d", { source: "website" })], WHO, DATE);
    expect(String(patch.notes)).toContain("Notes, Potential services, Business description from website and record, unverified.");
  });
});

describe("saving a phone number or email found on a website", () => {
  it("puts an email in the empty email field", () => {
    const { patch, placed } = detailPatch(blank, "email", "info@57joinery.ie", WHO, DATE);
    expect(placed).toBe("email");
    expect(patch.email).toBe("info@57joinery.ie");
    expect(patch.notes).toContain("Email from their website, unverified");
  });

  it("puts an Irish mobile in Mobile and any other number in Telephone, as written on the site", () => {
    expect(detailPatch(blank, "phone", "087 123 4567", WHO, DATE)).toMatchObject({ placed: "mobile", patch: { mobile: "087 123 4567" } });
    expect(detailPatch(blank, "phone", "+353 87 123 4567", WHO, DATE)).toMatchObject({ placed: "mobile" });
    expect(detailPatch(blank, "phone", "059 913 0100", WHO, DATE)).toMatchObject({ placed: "phone", patch: { phone: "059 913 0100" } });
    expect(detailPatch(blank, "phone", "+353 1 555 0100", WHO, DATE)).toMatchObject({ placed: "phone" });
  });

  it("never overwrites a field that is filled: it goes into the notes instead", () => {
    const current = { ...blank, email: "old@example.test", phone: "01 555 0100", mobile: "087 000 0000", notes: "Existing note" };
    for (const [kind, value] of [["email", "new@example.test"], ["phone", "087 123 4567"], ["phone", "059 913 0100"]] as const) {
      const { patch, placed } = detailPatch(current, kind, value, WHO, DATE);
      expect(placed, value).toBe("notes");
      expect(patch, value).not.toHaveProperty("email");
      expect(patch, value).not.toHaveProperty("phone");
      expect(patch, value).not.toHaveProperty("mobile");
      expect(String(patch.notes)).toMatch(new RegExp(`^Existing note\nAI-assisted .*${value}`));
    }
  });

  it("uses the Telephone field for a second mobile when it is free", () => {
    expect(detailPatch({ ...blank, mobile: "087 000 0000" }, "phone", "086 111 2222", WHO, DATE)).toMatchObject({ placed: "phone", patch: { phone: "086 111 2222" } });
  });
});
