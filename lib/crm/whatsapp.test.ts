import { describe, expect, it } from "vitest";
import { chatLink, chooseNumber, DEFAULT_TEMPLATES, fillTemplate, firstName, TEMPLATE_MAX, unknownPlaceholders, whatsappNumber } from "./whatsapp";

const fill = (over: Partial<Parameters<typeof fillTemplate>[1]> = {}) => ({ name: "Sean", company: "Murphy Joinery", county: "Kilkenny", sender: "Joanna", offer: "free quote", code: "KK10", ...over });

describe("whatsappNumber", () => {
  it("puts the usual ways of writing an Irish mobile into the form WhatsApp wants", () => {
    for (const raw of ["087 123 4567", "0871234567", "+353 87 123 4567", "00353 87 123 4567", "00353 (0)87 123 4567", "+353 (0) 87 123 4567", "(087) 123-4567"]) {
      expect(whatsappNumber(raw), raw).toEqual({ number: "353871234567", mobile: true });
    }
  });

  it("knows a landline is not a mobile", () => {
    for (const raw of ["01 555 0100", "+353 1 555 0100", "021 123 4567", "059 913 1234"]) expect(whatsappNumber(raw)?.mobile, raw).toBe(false);
  });

  it("accepts a number from another country, which it cannot tell apart", () => {
    expect(whatsappNumber("+44 7700 900123")).toEqual({ number: "447700900123", mobile: true });
    expect(whatsappNumber("0044 7700 900123")).toEqual({ number: "447700900123", mobile: true });
  });

  it("refuses what is not a number, or cannot be placed", () => {
    for (const raw of ["", "   ", null, undefined, "call the office", "871234567", "01 234", "+44 12", "087 12", "12345678901234567890"]) expect(whatsappNumber(raw as string), String(raw)).toBeNull();
  });
});

describe("chooseNumber", () => {
  it("prefers the company's mobile, then a phone that is a mobile, then a contact's", () => {
    expect(chooseNumber({ mobile: "087 111 2222", phone: "086 333 4444" }, ["085 555 6666"])).toMatchObject({ number: "353871112222", from: "mobile", shown: "087 111 2222" });
    expect(chooseNumber({ mobile: null, phone: "086 333 4444" }, ["085 555 6666"])).toMatchObject({ number: "353863334444", from: "phone" });
    expect(chooseNumber({ mobile: null, phone: "01 555 0100" }, [null, "085 555 6666"])).toMatchObject({ number: "353855556666", from: "contact" });
  });

  it("skips a landline in the mobile field in favour of a real mobile elsewhere", () => {
    expect(chooseNumber({ mobile: "01 555 0100", phone: "087 111 2222" }, [])).toMatchObject({ number: "353871112222", from: "phone" });
  });

  it("says why there is no number to use", () => {
    expect(chooseNumber({ mobile: null, phone: "01 555 0100" }, [])).toMatchObject({ number: null, shown: "01 555 0100", reason: expect.stringContaining("landline") });
    expect(chooseNumber({ mobile: null, phone: null }, [null])).toMatchObject({ number: null, shown: null, reason: "No phone number on record" });
    expect(chooseNumber({ mobile: "ask for Pat", phone: null }, [])).toMatchObject({ number: null, reason: expect.stringContaining("not a valid") });
  });
});

describe("firstName", () => {
  it("takes the first word of a name, tidied", () => {
    expect(firstName("Sean Murphy")).toBe("Sean");
    expect(firstName("  mary  o'brien ")).toBe("Mary");
    expect(firstName("PADRAIG KELLY")).toBe("Padraig");
    expect(firstName("Seán Ó Briain")).toBe("Seán");
  });

  it("gives nothing when there is no usable first name", () => {
    for (const raw of [null, undefined, "", "  ", "J Murphy", "Mr", "Mr Murphy", "Dr. Kelly", "123"]) expect(firstName(raw as string), String(raw)).toBeNull();
  });
});

describe("fillTemplate", () => {
  it("fills every blank", () => {
    const r = fillTemplate("Hi {name}, {sender} here. {company} in {county}: {offer}, code {code}.", fill());
    expect(r).toEqual({ text: "Hi Sean, Joanna here. Murphy Joinery in Kilkenny: free quote, code KK10.", problems: [] });
  });

  it("says 'there' when the company has no contact", () => {
    expect(fillTemplate("Hi {name},", fill({ name: null })).text).toBe("Hi there,");
  });

  it("fills a blank used twice, and leaves ordinary text and braces alone", () => {
    expect(fillTemplate("{company}? Yes, {company}. {} and { x } stay.", fill()).text).toBe("Murphy Joinery? Yes, Murphy Joinery. {} and { x } stay.");
  });

  it("reports what it cannot fill, and leaves the blank visible rather than inventing something", () => {
    const noCounty = fillTemplate("In {county}: {offer} {code}", fill({ county: null, offer: null, code: null }));
    expect(noCounty.text).toContain("{county}");
    expect(noCounty.problems).toEqual(["This company has no county set", "This company has no county set, so there is no special to use", "This company has no county set, so there is no special code to use"]);

    expect(fillTemplate("{offer}", fill({ offer: null })).problems).toEqual(["No special is running in Kilkenny"]);
    expect(fillTemplate("{code}", fill({ code: null })).problems).toEqual(["The special running in Kilkenny has no code"]);
    expect(fillTemplate("{nmae}", fill()).problems).toEqual(["The template has an unknown blank {nmae}"]);
  });

  it("does not mention a problem for a blank the template does not use", () => {
    expect(fillTemplate("Hi {name}", fill({ county: null, offer: null, code: null })).problems).toEqual([]);
  });

  it("does not treat a customer's text as a blank to fill (no second round of replacement)", () => {
    expect(fillTemplate("Hi {name}", fill({ name: "{sender}" })).text).toBe("Hi {sender}");
  });

  it("the starter messages use only blanks that exist and fit the limit", () => {
    for (const t of Object.values(DEFAULT_TEMPLATES)) {
      expect(unknownPlaceholders(t)).toEqual([]);
      expect(t.length).toBeLessThanOrEqual(TEMPLATE_MAX);
      expect(fillTemplate(t, fill()).problems).toEqual([]);
    }
  });
});

describe("unknownPlaceholders", () => {
  it("lists each unknown blank once", () => {
    expect(unknownPlaceholders("Hi {nmae} {name} {nmae} {price}")).toEqual(["{nmae}", "{price}"]);
    expect(unknownPlaceholders("Hi {name}, no blanks {} here")).toEqual([]);
  });
});

describe("chatLink", () => {
  it("opens WhatsApp with the message typed in, safely encoded", () => {
    const link = chatLink("353871234567", "Hi Sean & co, 100% sure?\nBye #1");
    expect(link).toBe("https://wa.me/353871234567?text=Hi%20Sean%20%26%20co%2C%20100%25%20sure%3F%0ABye%20%231");
    expect(decodeURIComponent(link.split("?text=")[1])).toBe("Hi Sean & co, 100% sure?\nBye #1");
  });
});
