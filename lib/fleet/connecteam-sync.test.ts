import { beforeEach, describe, expect, it, vi } from "vitest";
import { stageOnEntry, type Van } from "./fleet";

const state = vi.hoisted(() => ({
  vans: [] as any[],
  updates: [] as { id: string | string[]; values: Record<string, unknown> }[],
  catalog: [] as any[],
  rows: [] as any[],
  users: [] as any[],
}));

vi.mock("@/lib/connecteam/client", () => ({
  isConnecteamConfigured: () => true,
  fetchDocumentCatalog: async () => state.catalog,
  fetchUserDocuments: async () => state.rows,
  fetchAllConnecteamUsers: async () => state.users,
}));
vi.mock("./service", () => ({ listVans: async () => state.vans, todayKey: () => "2026-11-16" }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => ({
      update: (values: Record<string, unknown>) => ({
        eq: async (_c: string, id: string) => (state.updates.push({ id, values }), { error: null }),
        in: async (_c: string, ids: string[]) => (state.updates.push({ id: ids, values }), { error: null }),
      }),
    }),
  }),
}));

import { syncVanDocuments } from "./connecteam-sync";

const van = (over: Partial<Van> = {}): Van => ({
  id: "v1", reg: "191 D 1", reg_key: "191D1", model: null, driver: "Mike.", lender: null, agreement: null, value_eur: null, monthly_eur: null,
  settlement_eur: null, weight_kg: null, tax_pin: null, tax_due: null, doe_due: null, insurance_due: null, tax_alerted_stage: 0, doe_alerted_stage: 0,
  insurance_alerted_stage: 0, connecteam_user_id: null, tax_from_connecteam: false, doe_from_connecteam: false, insurance_from_connecteam: false,
  status: "active", notes: null, updated_at: "2026-11-01T00:00:00Z", ...over,
});

const day = (iso: string) => Math.floor(new Date(`${iso}T00:00:00Z`).getTime() / 1000);
const forVan = (id: string) => state.updates.find((u) => u.id === id)?.values;

beforeEach(() => {
  state.updates = [];
  state.catalog = [
    { documentId: 1, name: "Van tax" },
    { documentId: 2, name: "Van DOE" },
    { documentId: 3, name: "Van insurance" },
  ];
  state.users = [
    { userId: 30, firstName: "B", lastName: "Mike Olds" },
    { userId: 40, firstName: "K", lastName: "Alex Koufalis" },
    { userId: 41, firstName: "K", lastName: "Alex Vrajitoru" },
  ];
  state.rows = [
    { userId: 30, documentId: 1, expiresAt: day("2027-06-29") },
    { userId: 30, documentId: 2, expiresAt: day("2026-06-30") },
    { userId: 30, documentId: 3 },
    { userId: 40, documentId: 1, expiresAt: day("2027-01-01") },
    { userId: 41, documentId: 1, expiresAt: day("2027-02-01") },
  ];
});

describe("syncVanDocuments", () => {
  it("links a van by first name and writes the tax and DOE dates, leaving insurance as typed where Connecteam has no date", async () => {
    state.vans = [van({ insurance_due: "2027-03-03" })];
    const result = await syncVanDocuments();

    expect(result).toMatchObject({ linked: 1, newlyLinked: 1, datesUpdated: 2, needPicking: 0, missingDocuments: [], noDatesInConnecteam: ["insurance"] });
    const u = forVan("v1")!;
    expect(u.connecteam_user_id).toBe(30);
    expect(u.tax_due).toBe("2027-06-29");
    expect(u.doe_due).toBe("2026-06-30");
    expect(u.tax_from_connecteam).toBe(true);
    expect(u.doe_from_connecteam).toBe(true);
    expect(u).not.toHaveProperty("insurance_due");
    expect(u).not.toHaveProperty("insurance_from_connecteam");
  });

  it("does not set off a warning for a date that is already past: the stage is recorded where it already stands", async () => {
    state.vans = [van()];
    await syncVanDocuments();
    const u = forVan("v1")!;
    expect(u.doe_alerted_stage).toBe(stageOnEntry("2026-06-30", "2026-11-16")); // 30 June 2026 is long past
    expect(u.doe_alerted_stage).toBeGreaterThan(0);
    expect(u.tax_alerted_stage).toBe(0); // June 2027 is far off
  });

  it("does not guess between two people with the same first name, and counts the van as needing a pick", async () => {
    state.vans = [van({ driver: "Alex." })];
    const result = await syncVanDocuments();
    expect(result).toMatchObject({ linked: 0, newlyLinked: 0, datesUpdated: 0, needPicking: 1 });
    expect(forVan("v1")).toBeUndefined();
  });

  it("uses the person an Admin picked, and never changes it", async () => {
    state.vans = [van({ driver: "Alex.", connecteam_user_id: 41 })];
    const result = await syncVanDocuments();
    expect(result).toMatchObject({ linked: 1, newlyLinked: 0, datesUpdated: 1 });
    const u = forVan("v1")!;
    expect(u.tax_due).toBe("2027-02-01");
    expect(u).not.toHaveProperty("connecteam_user_id");
  });

  it("writes nothing to a van whose dates already match, other than marking them as from Connecteam once", async () => {
    state.vans = [van({ connecteam_user_id: 30, tax_due: "2027-06-29", doe_due: "2026-06-30", tax_from_connecteam: true, doe_from_connecteam: true })];
    const result = await syncVanDocuments();
    expect(result.datesUpdated).toBe(0);
    expect(forVan("v1")).toBeUndefined();
  });

  it("ignores vans that have gone when linking by name", async () => {
    state.vans = [van({ status: "gone" })];
    const result = await syncVanDocuments();
    expect(result).toMatchObject({ linked: 0, needPicking: 0 });
  });

  it("reports a missing document and still reads the others", async () => {
    state.catalog = [{ documentId: 1, name: "Van tax" }];
    state.vans = [van()];
    const result = await syncVanDocuments();
    expect(result.missingDocuments).toEqual(["doe", "insurance"]);
    expect(forVan("v1")!.tax_due).toBe("2027-06-29");
  });

  it("does nothing when Connecteam has none of the documents", async () => {
    state.catalog = [{ documentId: 9, name: "Safe Pass" }];
    state.vans = [van()];
    const result = await syncVanDocuments();
    expect(result).toMatchObject({ linked: 0, datesUpdated: 0, missingDocuments: ["tax", "doe", "insurance"] });
    expect(state.updates).toHaveLength(0);
  });

  it("records when the dates were last read on every van", async () => {
    state.vans = [van({ id: "a" }), van({ id: "b", driver: null })];
    await syncVanDocuments();
    const stamp = state.updates.find((u) => Array.isArray(u.id));
    expect(stamp?.id).toEqual(["a", "b"]);
    expect(typeof stamp?.values.dates_synced_at).toBe("string");
  });
});
