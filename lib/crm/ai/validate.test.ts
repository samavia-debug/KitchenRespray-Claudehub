import { describe, expect, it } from "vitest";
import { cleanAiSettings, cleanAskInput, cleanDraftInput, cleanResearchInput } from "./validate";

const ID = "11111111-1111-4111-8111-111111111111";
const err = (r: any) => ("error" in r ? (r.error as string) : "");

describe("cleanAskInput", () => {
  it("takes a question with the period and filters", () => {
    const r = cleanAskInput({ question: "  How many quotes?  ", range: "this_month", category_id: "none", staff_id: ID });
    expect("value" in r && r.value).toEqual({ question: "How many quotes?", range: "this_month", from: null, to: null, category_id: "__none__", staff_id: ID });
  });

  it("needs a real question, of a sensible length, and valid filters", () => {
    expect(err(cleanAskInput({ question: "  " }))).toMatch(/Type your question/);
    expect(err(cleanAskInput({ question: "ab" }))).toMatch(/Type your question/);
    expect(err(cleanAskInput({ question: "x".repeat(501) }))).toMatch(/500/);
    expect(err(cleanAskInput({ question: "Hello there", category_id: "zzz" }))).toMatch(/category/);
    expect(err(cleanAskInput({ question: "Hello there", staff_id: "zzz" }))).toMatch(/person/);
    expect(err(cleanAskInput(null))).toMatch(/Nothing/);
  });
});

describe("cleanDraftInput", () => {
  it("takes a company, a channel, and optional contact and instructions", () => {
    const r = cleanDraftInput({ company_id: ID, contact_id: ID, channel: "WhatsApp", kind: "follow_up", instructions: "  Keep it short " });
    expect("value" in r && r.value).toEqual({ company_id: ID, contact_id: ID, channel: "WhatsApp", kind: "follow_up", instructions: "Keep it short" });
  });

  it("defaults to an introduction with no contact, and refuses anything unknown", () => {
    const r = cleanDraftInput({ company_id: ID, channel: "Email" });
    expect("value" in r && r.value).toMatchObject({ kind: "introduction", contact_id: null, instructions: "" });
    expect(err(cleanDraftInput({ company_id: "x", channel: "Email" }))).toMatch(/company/);
    expect(err(cleanDraftInput({ company_id: ID, channel: "Carrier pigeon" }))).toMatch(/WhatsApp, email or letter/);
    expect(err(cleanDraftInput({ company_id: ID, channel: "Email", contact_id: "x" }))).toMatch(/contact/);
    expect(err(cleanDraftInput({ company_id: ID, channel: "Email", instructions: "x".repeat(601) }))).toMatch(/600/);
  });
});

describe("cleanResearchInput", () => {
  it("reads the website only when told to, exactly", () => {
    expect("value" in cleanResearchInput({ company_id: ID, read_website: true }) && (cleanResearchInput({ company_id: ID, read_website: true }) as any).value.read_website).toBe(true);
    for (const v of ["true", 1, "yes", undefined, null]) expect((cleanResearchInput({ company_id: ID, read_website: v }) as any).value.read_website).toBe(false);
    expect(err(cleanResearchInput({ company_id: "x" }))).toMatch(/company/);
  });
});

describe("cleanAiSettings", () => {
  it("turns blanks into nothing and keeps the wording", () => {
    const r = cleanAiSettings({ about_us: "  We respray kitchens.  ", intro_template: "", tone: null });
    expect("value" in r && r.value).toEqual({ about_us: "We respray kitchens.", intro_template: null, tone: null, avoid: null });
  });

  it("limits each setting and refuses anything that is not text", () => {
    expect(err(cleanAiSettings({ about_us: "x".repeat(3001) }))).toMatch(/too long/);
    expect(err(cleanAiSettings({ tone: "x".repeat(301) }))).toMatch(/too long/);
    expect(err(cleanAiSettings({ avoid: 5 }))).toMatch(/text/);
  });
});
