// A small in-memory stand-in for the database, for tests only. It understands just the query-builder calls the
// CRM service makes, and nothing else, so a query it cannot handle fails loudly instead of quietly passing.

export type Row = Record<string, any>;

export const fake = {
  tables: {} as Record<string, Row[]>,
  nextId: 1,
  /** Name a table here and every query against it fails, to test how errors are handled. */
  failTable: null as string | null,
  reset() {
    for (const k of Object.keys(this.tables)) delete this.tables[k];
    this.nextId = 1;
    this.failTable = null;
  },
};

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
  crm_tasks: [["company", "crm_companies", "company_id"], ["contact", "crm_contacts", "contact_id"], ["assignee", "profiles", "assigned_to"]],
  crm_activities: [["contact", "crm_contacts", "contact_id"], ["user", "profiles", "user_id"]],
  crm_opportunities: [["assignee", "profiles", "assigned_to"]],
};

function withRelations(table: string, row: Row): Row {
  const out = { ...row };
  for (const [alias, other, column] of FORWARD[table] ?? []) out[alias] = (fake.tables[other] ?? []).find((r) => r.id === row[column]) ?? null;
  return out;
}

function run(q: any): { data?: any; error: { message: string } | null; count?: number } {
  if (fake.failTable === q.table) return { error: { message: `${q.table} unavailable` } };
  const rows = (fake.tables[q.table] ||= []);
  const matches = (r: Row) => q.preds.every((p: (r: Row) => boolean) => p(r));

  if (q.op === "insert") {
    const row = { id: `id${fake.nextId++}`, created_at: new Date().toISOString(), archived_at: null, ...q.payload };
    rows.push(row);
    return { data: q.single ? row : [row], error: null };
  }
  if (q.op === "update") {
    const hit = rows.filter((r) => matches(withRelations(q.table, r)));
    hit.forEach((r) => Object.assign(r, q.payload));
    return { data: hit.map((r) => ({ ...r })), error: null };
  }
  if (q.op === "delete") {
    const hit = rows.filter((r) => matches(withRelations(q.table, r)));
    fake.tables[q.table] = rows.filter((r) => !hit.includes(r));
    return { data: hit, error: null };
  }

  let out = rows.map((r) => withRelations(q.table, r));
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
    delete() { q.op = "delete"; return api; },
    eq(c: string, v: any) { q.preds.push((r: Row) => get(r, c) === v); return api; },
    neq(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== v); return api; },
    is(c: string, v: any) { q.preds.push((r: Row) => (v === null ? get(r, c) === null || get(r, c) === undefined : get(r, c) === v)); return api; },
    in(c: string, vs: any[]) { q.preds.push((r: Row) => vs.includes(get(r, c))); return api; },
    ilike(c: string, p: string) { q.preds.push((r: Row) => typeof get(r, c) === "string" && likeToRegex(p, "i").test(get(r, c))); return api; },
    gte(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== null && get(r, c) !== undefined && get(r, c) >= v); return api; },
    lte(c: string, v: any) { q.preds.push((r: Row) => get(r, c) !== null && get(r, c) !== undefined && get(r, c) <= v); return api; },
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
