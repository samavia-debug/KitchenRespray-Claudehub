import { describe, expect, it } from "vitest";
import { cleanItemInput } from "./input";

const ok = { title: " Driving  licence ", expiry_date: "2027-05-01", kind: "licence", holder_type: "person", holder_label: "Sean O'Brien" };

describe("cleanItemInput", () => {
  it("accepts a complete new item and tidies the text", () => {
    expect(cleanItemInput(ok, false)).toEqual({
      value: { title: "Driving licence", expiry_date: "2027-05-01", kind: "licence", holder_type: "person", holder_label: "Sean O'Brien" },
    });
  });

  it("requires a name and a real expiry date for a new item", () => {
    expect(cleanItemInput({ ...ok, title: "  " }, false)).toHaveProperty("error");
    expect(cleanItemInput({ ...ok, expiry_date: "" }, false)).toHaveProperty("error");
    expect(cleanItemInput({ ...ok, expiry_date: "2027-02-30" }, false)).toHaveProperty("error");
    expect(cleanItemInput(null, false)).toHaveProperty("error");
  });

  it("lets an edit send only what changed", () => {
    expect(cleanItemInput({ notes: "renewed" }, true)).toEqual({ value: { notes: "renewed" } });
    expect(cleanItemInput({ status: "dismissed" }, true)).toEqual({ value: { status: "dismissed" } });
  });

  it("still refuses a bad value in an edit", () => {
    expect(cleanItemInput({ expiry_date: "tomorrow" }, true)).toHaveProperty("error");
    expect(cleanItemInput({ kind: "banana" }, true)).toHaveProperty("error");
    expect(cleanItemInput({ status: "approved" }, true)).toHaveProperty("error");
    expect(cleanItemInput({ issued_date: "x" }, true)).toHaveProperty("error");
  });

  it("clears the issue date when sent blank", () => {
    expect(cleanItemInput({ issued_date: "" }, true)).toEqual({ value: { issued_date: null } });
  });

  it("drops the holder label for a company item", () => {
    const r = cleanItemInput({ ...ok, holder_type: "company", holder_label: "Someone" }, false);
    expect(r).toMatchObject({ value: { holder_type: "company", holder_label: null } });
  });

  it("asks who a person or vehicle item belongs to", () => {
    expect(cleanItemInput({ ...ok, holder_label: "" }, false)).toHaveProperty("error");
    expect(cleanItemInput({ holder_type: "vehicle", holder_label: " " }, true)).toHaveProperty("error");
  });
});
