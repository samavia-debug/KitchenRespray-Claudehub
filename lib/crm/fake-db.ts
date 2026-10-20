// A small in-memory stand-in for the database, for tests only. It understands just the query-builder calls the
// CRM service makes, and nothing else, so a query it cannot handle fails loudly instead of quietly passing.

export type Row = Record<string, any>;

export const fake = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  /** Make new ids look like real UUIDs, for tests that go through routes that check them. */
  uuidIds: false,
  /** Name a table here and every query against it fails, to test how errors are handled. */
  failTable: null as string | null,
  /** Return a message to make an insert of that row fail. A multi-row insert fails whole, as a real one does. */
  rejectRow: null as ((table: string, row: Row) => string | null) | null,
  inserts: 0,
  reset() {
    for (const k of Object.keys(this.tables)) delete this.tables[k];
    this.nextId = 1;
    this.uuidIds = false;
    this.failTable = null;
    this.rejectRow = null;
    this.inserts = 0;
  },
};

function newId(): string {
  const n = fake.nextId++;
  return fake.uuidIds ? `00000000-0000-4000-8000-${String(n).padStart(12, "0")}` : `id${n}`;
}

function split(str: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

const likeToRegex = (pat: string, flags = "") => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, flags);

/** Compares two timestamps as moments, so "+00:00" and "Z" spellings of the same instant are equal. */
function cmp(a: any, b: any): number {
  const x = typeof a === "string" && /^\d{4}-\d{2}-\d{2}T/.test(a) ? Date.parse(a) : a;
  const y = typeof b === "string" && /^\d{4}-\d{2}-\d{2}T/.test(b) ? Date.parse(b) : b;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Reads "company.archived_at" from a row that has the related company attached. */
const get = (row: Row, path: string) => path.split(".").reduce<any>((v, k) => (v === null || v === undefined ? v : v[k]), row);

function test(row: Row, clause: string): boolean {
  if (clause.startsWith("and(")) return split(clause.slice(4, -1)).every((c) => test(row, c));
  const first = clause.indexOf(".");
  const second = clause.indexOf(".", first + 1);
  const col = clause.slice(0, first);
  const op = clause.slice(first + 1, second);
  const value = clause.slice(second + 1);
  const v = get(row, col);
  switch (op) {
    case "eq": return String(v) === value;
    case "is": return value === "null" ? v === null || v === undefined : v !== null && v !== undefined;
    case "in": return value.slice(1, -1).split(",").includes(String(v));
    case "lt": return v !== null && v !== undefined && String(v) < value;
    case "like": return typeof v === "string" && likeToRegex(value).test(v);
    case "ilike": return typeof v === "string" && likeToRegex(value, "i").test(v);
  }
  throw new Error(`fake db: unsupported filter ${clause}`);
}

// The related row each of the newer tables points at, so "company:crm_companies(...)" style selects work.
const FORWARD: Record<string, [alias: string, table: string, column: string][]> = {
  crm_companies: [["category", "crm_categories", "category_id"], ["stage", "crm_stages", "stage_id"], ["assignee", "profiles", "assigned_to"]],
  crm_tasks: [["company", "crm_companies", "company_id"], ["contact", "crm_contacts", "contact_id"], ["assignee", "profiles", "assigned_to"]],
  crm_activities: [["company", "crm_companies", "company_id"], ["contact", "crm_contacts", "contact_id"], ["user", "profiles", "user_id"]],
  crm_opportunities: [["company", "crm_companies", "company_id"], ["assignee", "profiles", "assigned_to"]],
  crm_contacts: [["company", "crm_companies", "company_id"], ["assignee", "profiles", "assigned_to"]],
};

/** Attaches the related rows a query asked for in its select, as the real database does (and no others). */
function withRelations(table: string, row: Row, select = ""): Row {
  const out = { ...row };
  for (const [alias, other, column] of FORWARD[table] ?? []) {
    if (select.includes(`${alias}:`)) out[alias] = (fake.tables[other] ?? []).find((r) => r.id === row[column]) ?? null;
  }
  return out;
}

function run(q: any): { data?: any; error: { message: string } | null; count?: number } {
  if (fake.failTable === q.table) return { error: { message: `${q.table} unavailable` } };
  const rows = (fake.tables[q.table] ||= []);
  const matches = (r: Row) => q.preds.every((p: (r: Row) => boolean) => p(r));

  if (q.op === "insert") {
    fake.inserts++;
    const payloads: Row[] = Array.isArray(q.payload) ? q.payload : [q.payload];
    for (const p of payloads) {
      const message = fake.rejectRow?.(q.table, p);
      if (message) return { error: { message } };
    }
    const made = payloads.map((p) => ({ id: newId(), created_at: new Date().toISOString(), archived_at: null, ...p }));
    rows.push(...made);
    return { data: q.single ? made[0] : made, error: null };
  }
  if (q.op === "upsert") {
    const existing = rows.find((r) => r[q.onConflict] === q.payload[q.onConflict]);
    if (existing) Object.assign(existing, q.payload);
    else rows.push({ created_at: new Date().toISOString(), ...q.payload });
    return { data: [existing ?? rows[rows.length - 1]], error: null };
  }
  if (q.op === "update") {
    const hit = rows.filter((r) => matches(withRelations(q.table, r, q.selectStr)));
    hit.forEach((r) => Object.assign(r, q.payload));
    return { data: hit.map((r) => ({ ...r })), error: null };
  }
  if (q.op === "delete") {
    const hit = rows.filter((r) => matches(withRelations(q.table, r, q.selectStr)));
    fake.tables[q.table] = rows.filter((r) => !hit.includes(r));
    return { data: hit, error: null };
  }

  let out = rows.map((r) => withRelations(q.table, r, q.selectStr ?? ""));
  // "!inner" drops rows whose related row is missing.
  if (/company:crm_companies!inner/.test(q.selectStr ?? "")) out = out.filter((r) => r.company);
  out = out.filter(matches);
  const total = out.length;
  if (q.order.length) {
    out.sort((a, b) => {
      for (const [col, asc] of q.order) {
        const x = a[col] ?? null;
        const y = b[col] ?? null;
        if (x === y) continue;
        if (x === null) return 1;
        if (y === null) return -1;
        return (x < y ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
  }
  if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
  if (q.limit !== undefined) out = out.slice(0, q.limit);
  if (q.head) return { error: null, count: total };
  if (q.maybe) return { data: out[0] ?? null, error: null, count: total };
  return { data: out, error: null, count: total };
}

export function fakeFrom(table: string) {
  const q: any = { table, op: "select", preds: [], order: [] };
  const api: any = {
    select(cols?: string, opts?: any) {
      q.selectStr = cols;
      q.head = opts?.head;
      return api;
    },
    insert(p: any) { q.op = "insert"; q.payload = p; return api; },
    update(p: any) { q.op = "update"; q.payload = p; return api; },
    upsert(p: any, o?: { onConflict?: string }) { q.op = "upsert"; q.payload = p; q.onConflict = o?.onConflict ?? "id"; return api; },
    delete() { q.op = "delete"; return api; },
    eq(c: string, v: any) { q.preds.push((r: Row) => get(r, c) === v); return api; },
    neq(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== v); return api; },
    is(c: string, v: any) { q.preds.push((r: Row) => (v === null ? get(r, c) === null || get(r, c) === undefined : get(r, c) === v)); return api; },
    in(c: string, vs: any[]) { q.preds.push((r: Row) => vs.includes(get(r, c))); return api; },
    ilike(c: string, p: string) { q.preds.push((r: Row) => typeof get(r, c) === "string" && likeToRegex(p, "i").test(get(r, c))); return api; },
    gt(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== null && get(r, c) !== undefined && cmp(get(r, c), v) > 0); return api; },
    lt(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== null && get(r, c) !== undefined && cmp(get(r, c), v) < 0); return api; },
    gte(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== null && get(r, c) !== undefined && cmp(get(r, c), v) >= 0); return api; },
    lte(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== null && get(r, c) !== undefined && cmp(get(r, c), v) <= 0); return api; },
    or(s: string) { q.preds.push((r: Row) => split(s).some((c) => test(r, c))); return api; },
    order(c: string, o?: { ascending?: boolean }) { q.order.push([c, o?.ascending !== false]); return api; },
    range(a: number, b: number) { q.range = [a, b]; return api; },
    limit(n: number) { q.limit = n; return api; },
    maybeSingle() { q.maybe = true; return api; },
    single() { q.single = true; q.maybe = true; return api; },
    then(res: any, rej: any) { return Promise.resolve(run(q)).then(res, rej); },
  };
  return api;
}
