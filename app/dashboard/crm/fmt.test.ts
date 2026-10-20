import { describe, expect, it } from "vitest";
import { fmtMoney, followUpState, personName, whatsappLink } from "./fmt";

describe("whatsappLink", () => {
  it("builds a chat link for the usual ways of writing an Irish number", () => {
    expect(whatsappLink("087 123 4567")).toBe("https://wa.me/353871234567");
    expect(whatsappLink("+353 87 123 4567")).toBe("https://wa.me/353871234567");
    expect(whatsappLink("00353 (0)87 123 4567")).toBe("https://wa.me/353871234567");
    expect(whatsappLink("+44 7700 900123")).toBe("https://wa.me/447700900123");
  });

  it("gives no link for an Irish landline, which cannot have WhatsApp", () => {
    expect(whatsappLink("+353 1 555 0100")).toBeNull();
    expect(whatsappLink("01 555 0100")).toBeNull();
    expect(whatsappLink("021 123 4567")).toBeNull();
    expect(whatsappLink("085 123 4567")).toBe("https://wa.me/353851234567");
  });

  it("gives nothing when the number cannot be placed or is too short", () => {
    expect(whatsappLink("871234567")).toBeNull();
    expect(whatsappLink("01 234")).toBeNull();
    expect(whatsappLink(null)).toBeNull();
    expect(whatsappLink("")).toBeNull();
  });
});

describe("formatting", () => {
  it("shows people by name and amounts in euro", () => {
    expect(personName("joanna.byrne@example.ie")).toBe("Joanna Byrne");
    expect(personName(null)).toBe("Unassigned");
    expect(fmtMoney(12500)).toMatch(/12,500/);
    expect(fmtMoney(null)).toBe("—");
  });

  it("knows what is overdue", () => {
    expect(followUpState(null)).toBe("none");
    expect(followUpState("2000-01-01")).toBe("overdue");
    expect(followUpState("2999-01-01")).toBe("upcoming");
  });
});
