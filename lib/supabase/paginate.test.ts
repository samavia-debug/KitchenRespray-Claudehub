import { describe, expect, it } from "vitest";
import { fetchAllRows } from "./paginate";

// A stand-in for a table: returns the slice a real range() query would.
const table = (n: number) => (from: number, to: number) =>
  Promise.resolve({ data: Array.from({ length: Math.max(0, Math.min(to, n - 1) - from + 1) }, (_, i) => from + i), error: null });

describe("fetchAllRows", () => {
  it("keeps reading past a 1,000 row page cap and returns every row once", async () => {
    const rows = await fetchAllRows(table(2345));
    expect(rows).toHaveLength(2345);
    expect(rows[0]).toBe(0);
    expect(rows[2344]).toBe(2344);
    expect(new Set(rows).size).toBe(2345);
  });

  it("handles a table that is exactly a whole number of pages", async () => {
    expect(await fetchAllRows(table(2000))).toHaveLength(2000);
  });

  it("handles an empty table and a short one", async () => {
    expect(await fetchAllRows(table(0))).toEqual([]);
    expect(await fetchAllRows(table(7))).toHaveLength(7);
  });

  it("stops at the safety cap instead of looping forever", async () => {
    expect(await fetchAllRows(table(10_000), 1000, 3000)).toHaveLength(3000);
  });

  it("throws the database's error rather than returning partial data", async () => {
    let call = 0;
    const failing = async (from: number, to: number) => {
      call++;
      return call === 2 ? { data: null, error: { message: "boom" } } : table(5000)(from, to);
    };
    await expect(fetchAllRows(failing)).rejects.toThrow("boom");
  });
});
