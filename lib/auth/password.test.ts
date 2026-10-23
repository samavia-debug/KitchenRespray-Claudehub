import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { generatePassword } from "./password-generate";
import { checkPassword, PASSWORD_MAX, PASSWORD_MIN } from "./password-policy";

describe("what counts as a password", () => {
  it("accepts an ordinary one, spaces in the middle included", () => {
    for (const p of ["correct horse battery", "Tr0ub4dor&3", "k9#Lm2$Qx", "xxxxxxxy"]) expect(checkPassword(p, "joanna@example.ie"), p).toEqual({ value: p });
  });

  it("refuses one that is too short, empty or not text", () => {
    expect(checkPassword("a".repeat(PASSWORD_MIN - 2) + "!")).toEqual({ error: expect.stringContaining(`at least ${PASSWORD_MIN}`) });
    for (const bad of ["", null, undefined, 12345678, {}, []]) expect("error" in checkPassword(bad as string), String(bad)).toBe(true);
  });

  it("refuses one longer than the 72 bytes the hashing reads, counting a letter like é as two", () => {
    expect(checkPassword("ab".repeat(PASSWORD_MAX / 2))).toHaveProperty("value");
    expect(checkPassword("ab".repeat(PASSWORD_MAX / 2) + "c")).toEqual({ error: expect.stringContaining("too long") });
    expect(checkPassword("éa".repeat(24))).toHaveProperty("value"); // 72 bytes
    expect(checkPassword("éa".repeat(24) + "b")).toEqual({ error: expect.stringContaining("too long") });
  });

  it("refuses an easy guess: one repeated character, a well-known password, or the person's own email", () => {
    expect(checkPassword("aaaaaaaa")).toHaveProperty("error");
    expect(checkPassword("11111111")).toHaveProperty("error");
    expect(checkPassword("Password123")).toEqual({ error: expect.stringContaining("too common") });
    expect(checkPassword("12345678")).toHaveProperty("error");
    expect(checkPassword("joanna.byrne@example.ie", "Joanna.Byrne@example.ie")).toEqual({ error: expect.stringContaining("email") });
    expect(checkPassword("joanna.byrne", "joanna.byrne@example.ie")).toEqual({ error: expect.stringContaining("email") });
    expect(checkPassword("joanna.byrne2!", "joanna.byrne@example.ie")).toHaveProperty("value");
  });

  it("refuses one that starts or ends with a space, which is nearly always a slip", () => {
    expect(checkPassword(" leading space")).toHaveProperty("error");
    expect(checkPassword("trailing space ")).toHaveProperty("error");
  });
});

describe("a generated temporary password", () => {
  const many = Array.from({ length: 400 }, () => generatePassword());

  it("is 14 characters and always passes the rules", () => {
    for (const p of many) {
      expect(p).toHaveLength(14);
      expect(checkPassword(p), p).toEqual({ value: p });
    }
  });

  it("has a lower-case letter, a capital, a digit and a symbol every time, and nothing easily misread", () => {
    for (const p of many) {
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[!@#$%&*?]/);
      expect(p).not.toMatch(/[IlO01]/);
      expect(p).toMatch(/^[A-Za-z2-9!@#$%&*?]+$/);
    }
  });

  it("is different every time and is not built in a fixed order", () => {
    expect(new Set(many).size).toBe(many.length);
    expect(many.some((p) => !/[a-z]/.test(p[0]))).toBe(true);
    expect(many.some((p) => !/[!@#$%&*?]/.test(p[13]))).toBe(true);
  });

  it("can be made at another length", () => {
    expect(generatePassword(20)).toHaveLength(20);
    expect(generatePassword(8)).toHaveLength(8);
  });
});

describe("where passwords come from", () => {
  it("never uses Math.random, whose output can be predicted, in anything that makes or sets a password", () => {
    const files = [
      "lib/auth/password-generate.ts",
      "lib/auth/accounts.ts",
      ...readdirSync(new URL("../../app/api/admin", import.meta.url)).map((d) => `app/api/admin/${d}/route.ts`),
      "app/api/account/change-password/route.ts",
    ];
    for (const f of files) expect(readFileSync(join(__dirname, "../..", f), "utf8"), f).not.toMatch(/Math\.random/);
  });

  it("keeps the generator out of the browser's code, and the rules in it, so the secure random source stays on the server", () => {
    const client = ["app/dashboard/change-password-form.tsx", "app/reset-password/page.tsx", "app/dashboard/settings/page.tsx"];
    for (const f of client) {
      const source = readFileSync(join(__dirname, "../..", f), "utf8");
      expect(source, f).not.toMatch(/password-generate/);
      expect(source, f).toMatch(/password-policy/);
    }
  });
});
