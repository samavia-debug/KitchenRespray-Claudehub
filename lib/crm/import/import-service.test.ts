import { beforeEach, describe, expect, it, vi } from "vitest";
import { fake, fakeFrom } from "../fake-db";

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from: fakeFrom }) }));
const tables = fake.tables;

import { commitImport, listBatches, previewImport, undoBatch } from "./import-service";
import { cleanImportInput, type ImportInput } from "./validate";

const USER = "user-joanna";
const HEADERS = ["Company", "Website", "Email", "Phone", "Mobile", "City", "Rating", "Contact", "Contact email"];
const TARGETS = ["name", "website", "email", "phone", "mobile", "city", "extra", "contact_name", "contact_email"];

const line = (name: string, o: Partial<Record<"website" | "email" | "phone" | "mobile" | "city" | "rating" | "contact" | "contactEmail", string>> = {}) => [
  name, o.website ?? "", o.email ?? "", o.phone ?? "", o.mobile ?? "", o.city ?? "", o.rating ?? "", o.contact ?? "", o.contactEmail ?? "",
];

function input(rows: string[][], over: Partial<ImportInput> = {}): ImportInput {
  return { filename: "leads.xlsx", headers: HEADERS, rows, targets: TARGETS, defaults: { category_id: null, source: null, assigned_to: null, priority: null }, decisions: {}, confirmed: true, ...over };
}

beforeEach(() => {
  fake.reset();
  tables.crm_stages = [
    { id: "stage-new", name: "New Prospect", kind: "open", sort_order: 1, active: true },
    { id: "stage-won", name: "Won", kind: "won", sort_order: 9, active: true },
  ];
  tables.crm_categories = [{ id: "cat-builders", name: "Builders", sort_order: 1, active: true }];
  tables.profiles = [
    { id: USER, email: "joanna@example.test", role: "Staff" },
    { id: "user-viewer", email: "viewer@example.test", role: "Viewer" },
  ];
  tables.crm_companies = [];
  tables.crm_contacts = [];
});

const companies = () => tables.crm_companies;

describe("previewImport", () => {
  it("shows what would happen without saving anything", async () => {
    const r = await previewImport(input([line("Ace Roofing", { phone: "087 111 2222" }), line(""), line("Beta Builders")]));
    expect("plan" in r && r.counts).toEqual({ total: 3, ready: 2, duplicates: 0, errors: 1, withWarnings: 0, willImport: 2, willSkip: 1 });
    expect(companies()).toHaveLength(0);
    expect(tables.crm_import_batches ?? []).toHaveLength(0);
  });

  it("recognises a company that is already in the CRM, by its phone number written another way", async () => {
    companies().push({ id: "c1", name: "Ace Roofing", city: "Dublin", archived_at: null, name_key: "ace roofing", phone_key: "871112222", mobile_key: null, website_domain: null, email_domain: null, address_key: null });
    const r = await previewImport(input([line("Another Name", { mobile: "+353 87 111 2222" })]));
    expect("plan" in r && r.plan[0]).toMatchObject({ status: "duplicate", defaultAction: "skip" });
    expect("plan" in r && r.plan[0].matches[0].id).toBe("c1");
    expect("counts" in r && r.counts.willSkip).toBe(1);
  });

  it("refuses defaults that point at nothing", async () => {
    expect(await previewImport(input([line("Ace")], { defaults: { category_id: "nope", source: null, assigned_to: null, priority: null } }))).toMatchObject({ error: expect.stringMatching(/category/) });
    expect(await previewImport(input([line("Ace")], { defaults: { category_id: null, source: null, assigned_to: "user-viewer", priority: null } }))).toMatchObject({ error: expect.stringMatching(/owner/) });
  });
});

describe("commitImport", () => {
  it("will not run unless it has been confirmed", async () => {
    expect(await commitImport(input([line("Ace")], { confirmed: false }), USER)).toEqual({ error: "The import needs to be confirmed" });
    expect(companies()).toHaveLength(0);
  });

  it("saves the good rows with their search keys, the first stage, the extras and the batch, and skips the rest", async () => {
    const r = await commitImport(
      input([line("Ace Roofing Ltd", { website: "aceroofing.ie", phone: "01 555 0100", mobile: "087 123 4567", city: "Dublin", rating: "4.5" }), line(""), line("Beta Builders", { email: "not-an-email" })], {
        defaults: { category_id: "cat-builders", source: "Google Maps list", assigned_to: USER, priority: "High" },
      }),
      USER
    );
    expect(r).toMatchObject({ imported: 2, skippedCount: 1, failedCount: 0, warningCount: 1, contactsCreated: 0 });
    expect("skipped" in r && r.skipped[0]).toEqual({ row: 3, label: "(no name)", reason: "There is no company name" });

    const [ace, beta] = companies();
    expect(ace).toMatchObject({
      name: "Ace Roofing Ltd", website: "https://aceroofing.ie", phone: "01 555 0100", mobile: "087 123 4567", city: "Dublin",
      name_key: "ace roofing", phone_key: "15550100", mobile_key: "871234567", website_domain: "aceroofing.ie",
      stage_id: "stage-new", category_id: "cat-builders", source: "Google Maps list", assigned_to: USER, priority: "High",
      extra: { Rating: "4.5" }, created_by: USER,
    });
    expect(ace.import_batch_id).toBe("batch" in r ? undefined : tables.crm_import_batches[0].id);
    expect(beta.email ?? null).toBeNull();
    expect(beta.extra).toEqual({ "Not imported: Email": "not-an-email" });
    expect(tables.crm_import_batches[0]).toMatchObject({ filename: "leads.xlsx", row_count: 3, imported_count: 2, skipped_count: 1, failed_count: 0, created_by: USER });
    expect(ace.created_at).toBe(ace.updated_at);
  });

  it("never changes a company that is already there, and skips a strong look-alike by default", async () => {
    const original = { id: "c1", name: "Ace Roofing", city: "Dublin", notes: "Spoke to Mick", archived_at: null, name_key: "ace roofing", phone_key: "871112222", mobile_key: null, website_domain: null, email_domain: null, address_key: null };
    companies().push({ ...original });
    const r = await commitImport(input([line("Ace Roofing Ltd", { phone: "087 111 2222", city: "Cork" }), line("Brand New")]), USER);
    expect(r).toMatchObject({ imported: 1, skippedCount: 1 });
    expect("skipped" in r && r.skipped[0].reason).toMatch(/Looks like Ace Roofing/);
    expect(companies().find((c) => c.id === "c1")).toEqual(original);
    expect(companies().map((c) => c.name)).toEqual(["Ace Roofing", "Brand New"]);
  });

  it("follows the person's choices: import a look-alike anyway, skip a clean row", async () => {
    companies().push({ id: "c1", name: "Ace Roofing", city: "Dublin", archived_at: null, name_key: "ace roofing", phone_key: "871112222", mobile_key: null, website_domain: null, email_domain: null, address_key: null });
    const r = await commitImport(input([line("Ace Again", { phone: "087 111 2222" }), line("Clean One"), line("Clean Two")], { decisions: { 0: "import", 1: "skip" } }), USER);
    expect(r).toMatchObject({ imported: 2, skippedCount: 1 });
    expect(companies().map((c) => c.name).sort()).toEqual(["Ace Again", "Ace Roofing", "Clean Two"]);
  });

  it("will not import a row with an error even if told to", async () => {
    const r = await commitImport(input([line("")], { decisions: { 0: "import" } }), USER);
    expect(r).toMatchObject({ imported: 0, batchId: null, skippedCount: 1 });
    expect(companies()).toHaveLength(0);
    expect(tables.crm_import_batches ?? []).toHaveLength(0);
  });

  it("skips a repeat inside the same file", async () => {
    const r = await commitImport(input([line("Ace Roofing", { phone: "087 123 4567" }), line("ACE ROOFING LIMITED", { phone: "087 123 4567" })]), USER);
    expect(r).toMatchObject({ imported: 1, skippedCount: 1 });
    expect("skipped" in r && r.skipped[0]).toMatchObject({ row: 3, reason: "Looks like row 2 of this file" });
  });

  it("adds a contact for a company that has one, but not one already in the CRM", async () => {
    tables.crm_contacts.push({ id: "k1", company_id: "other", full_name: "Mary", email_key: "mary@cork.ie", phone_key: null });
    const r = await commitImport(input([line("Ace", { contact: "Mick Doyle", contactEmail: "MICK@ace.ie" }), line("Cork Co", { contact: "Mary O", contactEmail: "mary@cork.ie" })]), USER);
    expect(r).toMatchObject({ imported: 2, contactsCreated: 1 });
    const added = tables.crm_contacts.filter((c) => c.company_id);
    expect(added.find((c) => c.full_name === "Mick Doyle")).toMatchObject({ email: "mick@ace.ie", email_key: "mick@ace.ie", name_key: "mick doyle", import_batch_id: tables.crm_import_batches[0].id });
    expect(tables.crm_contacts.some((c) => c.full_name === "Mary O")).toBe(false);
  });

  it("imports in groups, and a refused row does not lose the rest of its group", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => line(`Firm ${i} Fitters`, { phone: `086 ${String(3000000 + i)}` }));
    fake.rejectRow = (table, row) => (table === "crm_companies" && row.name === "Firm 120 Fitters" ? "violates foreign key constraint" : null);
    const r = await commitImport(input(rows), USER);
    expect(r).toMatchObject({ imported: 249, failedCount: 1 });
    expect("failed" in r && r.failed).toEqual([{ row: 122, label: "Firm 120 Fitters", message: "It refers to a category or person that no longer exists" }]);
    expect(companies()).toHaveLength(249);
    expect(tables.crm_import_batches[0]).toMatchObject({ imported_count: 249, failed_count: 1 });
  });

  it("copes with a full-size file", async () => {
    const rows = Array.from({ length: 700 }, (_, i) => line(`Builder ${i} Ltd`, { phone: `01 ${String(4000000 + i)}`, city: "Dublin" }));
    const r = await commitImport(input(rows), USER);
    expect(r).toMatchObject({ imported: 700, failedCount: 0, skippedCount: 0 });
    expect(companies()).toHaveLength(700);
    expect(fake.inserts).toBeLessThan(20);
  });

  it("keeps what was in the file out of the audit trail", async () => {
    await commitImport(input([line("Secret Firm Name", { phone: "087 123 4567", contact: "Private Person", contactEmail: "p@secret.ie" })], { filename: "private-leads.xlsx" }), USER);
    const trail = JSON.stringify(tables.crm_events);
    expect(trail).not.toMatch(/Secret|Private|087|secret\.ie|private-leads/);
    expect(tables.crm_events[0]).toMatchObject({ action: "import_committed", meta: { imported: 1, skipped: 0, failed: 0, contacts: 1 } });
  });

  it("surfaces a database failure instead of reporting success", async () => {
    fake.failTable = "crm_import_batches";
    await expect(commitImport(input([line("Ace")]), USER)).rejects.toThrow(/Could not start the import/);
    expect(companies()).toHaveLength(0);
  });
});

describe("undoBatch", () => {
  async function imported(n = 3) {
    const r = await commitImport(input(Array.from({ length: n }, (_, i) => line(`Firm ${i}`, { phone: `087 ${String(5000000 + i)}` }))), USER);
    return "batchId" in r ? (r.batchId as string) : "";
  }

  it("removes the companies nobody has touched", async () => {
    const batchId = await imported();
    expect(await undoBatch(batchId, USER)).toEqual({ removed: 3, kept: 0 });
    expect(companies()).toHaveLength(0);
    expect(tables.crm_import_batches[0].undone_at).toBeTruthy();
    expect(tables.crm_import_batches[0].undone_by).toBe(USER);
  });

  it("keeps any company that has been edited, worked on, or given a contact by hand", async () => {
    const batchId = await imported(5);
    const [edited, withActivity, withTask, withContact, untouched] = companies();
    edited.updated_at = new Date(Date.parse(edited.created_at) + 5000).toISOString();
    tables.crm_activities = [{ id: "a1", company_id: withActivity.id }];
    tables.crm_tasks = [{ id: "t1", company_id: withTask.id }];
    tables.crm_contacts.push({ id: "k1", company_id: withContact.id, import_batch_id: null });

    expect(await undoBatch(batchId, USER)).toEqual({ removed: 1, kept: 4 });
    expect(companies().map((c) => c.id)).not.toContain(untouched.id);
    expect(companies()).toHaveLength(4);
  });

  it("keeps a company that has a document attached, so its file is never left behind", async () => {
    const batchId = await imported(2);
    const [withDocument, untouched] = companies();
    tables.crm_documents = [{ id: "d1", company_id: withDocument.id }];
    expect(await undoBatch(batchId, USER)).toEqual({ removed: 1, kept: 1 });
    expect(companies().map((c) => c.id)).toEqual([withDocument.id]);
    expect(companies().map((c) => c.id)).not.toContain(untouched.id);
  });

  it("leaves other imports and hand-made companies alone, and cannot be undone twice", async () => {
    companies().push({ id: "mine", name: "Hand made", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", import_batch_id: null });
    const batchId = await imported(2);
    await undoBatch(batchId, USER);
    expect(companies().map((c) => c.id)).toEqual(["mine"]);
    expect(await undoBatch(batchId, USER)).toEqual({ error: "This import has already been undone." });
    expect(await undoBatch("nope", USER)).toEqual({ notFound: true });
  });
});

describe("listBatches", () => {
  it("lists the latest imports with who ran them", async () => {
    await commitImport(input([line("Ace"), line("")]), USER);
    const list = await listBatches();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ filename: "leads.xlsx", created_by_email: "joanna@example.test", row_count: 2, imported_count: 1, skipped_count: 1, undone_at: null });
  });
});

describe("cleanImportInput", () => {
  const good = { filename: "x.csv", headers: ["Company", "Phone"], rows: [["Ace", "087 123 4567"]], targets: ["name", "phone"], defaults: {}, decisions: {}, confirmed: true };

  it("accepts a well-formed import and tidies the defaults", () => {
    const r = cleanImportInput({ ...good, defaults: { source: "  Maps  ", priority: "", category_id: null }, decisions: { 0: "skip" } });
    expect("value" in r && r.value).toMatchObject({ defaults: { source: "Maps", priority: null, category_id: null, assigned_to: null }, decisions: { 0: "skip" }, confirmed: true });
  });

  it("rejects rows that do not match the columns, a missing name column, and unknown targets", () => {
    const err = (o: object) => { const r = cleanImportInput({ ...good, ...o }); return "error" in r ? r.error : ""; };
    expect(err({ rows: [["only one"]] })).toMatch(/do not match/);
    expect(err({ rows: [] })).toMatch(/no rows/);
    expect(err({ targets: ["phone", "phone"] })).toMatch(/more than one/i);
    expect(err({ targets: ["phone", "ignore"] })).toMatch(/company name/);
    expect(err({ targets: ["name", "password"] })).toMatch(/not recognised/);
    expect(err({ headers: [] })).toMatch(/columns/);
    expect(err({ rows: [[1, 2]] })).toMatch(/do not match/);
  });

  it("rejects bad defaults and bad row choices", () => {
    const err = (o: object) => { const r = cleanImportInput({ ...good, ...o }); return "error" in r ? r.error : ""; };
    expect(err({ defaults: { category_id: "x" } })).toMatch(/category/);
    expect(err({ defaults: { assigned_to: "x" } })).toMatch(/owner/);
    expect(err({ defaults: { priority: "Urgent" } })).toMatch(/priority/);
    expect(err({ defaults: { source: "x".repeat(121) } })).toMatch(/source/);
    expect(err({ decisions: { 5: "import" } })).toMatch(/row choices/);
    expect(err({ decisions: { 0: "maybe" } })).toMatch(/row choices/);
  });

  it("is not confirmed unless confirmed is exactly true", () => {
    const r = cleanImportInput({ ...good, confirmed: "yes" });
    expect("value" in r && r.value.confirmed).toBe(false);
  });
});
