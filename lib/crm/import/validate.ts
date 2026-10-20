import { MAX_IMPORT_COLUMNS, MAX_IMPORT_ROWS } from "./parse";
import { validateMapping, type ImportDefaults } from "./mapping";
import { PRIORITIES, type Priority } from "../types";
import { isUuid } from "../validate";

export type ImportInput = {
  filename: string;
  headers: string[];
  rows: string[][];
  targets: string[];
  defaults: ImportDefaults;
  decisions: Record<number, "import" | "skip">;
  confirmed: boolean;
};

const MAX_CELL = 5000;

/**
 * Checks what the browser sends for an import. The server rebuilds everything from these rows, so each one is
 * checked here: the shape, the sizes, the mapping, the defaults and the per-row choices.
 */
export function cleanImportInput(input: unknown): { value: ImportInput } | { error: string } {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  if (!raw) return { error: "Nothing was sent" };

  const headers = raw.headers;
  if (!Array.isArray(headers) || headers.length === 0 || headers.length > MAX_IMPORT_COLUMNS || !headers.every((h) => typeof h === "string" && h.length <= 200)) return { error: "The columns are not valid. Upload the file again." };
  const rows = raw.rows;
  if (!Array.isArray(rows) || rows.length === 0) return { error: "There are no rows to import." };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `Import no more than ${MAX_IMPORT_ROWS} rows at a time.` };
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== headers.length || !r.every((c) => typeof c === "string" && c.length <= MAX_CELL)) return { error: "The rows do not match the columns. Upload the file again." };
  }

  const mappingError = validateMapping(raw.targets, headers.length);
  if (mappingError) return { error: mappingError };

  const d = raw.defaults && typeof raw.defaults === "object" ? (raw.defaults as Record<string, unknown>) : {};
  const orNull = (v: unknown) => (v === undefined || v === null || v === "" ? null : v);
  const category_id = orNull(d.category_id);
  const assigned_to = orNull(d.assigned_to);
  const priority = orNull(d.priority);
  const source = orNull(d.source);
  if (category_id !== null && !isUuid(category_id)) return { error: "The default category is not valid." };
  if (assigned_to !== null && !isUuid(assigned_to)) return { error: "The default owner is not valid." };
  if (priority !== null && !PRIORITIES.includes(priority as Priority)) return { error: "The default priority is not valid." };
  if (source !== null && (typeof source !== "string" || source.trim().length > 120)) return { error: "The default source is too long (120 characters at most)." };

  const decisions: Record<number, "import" | "skip"> = {};
  if (raw.decisions && typeof raw.decisions === "object" && !Array.isArray(raw.decisions)) {
    for (const [k, v] of Object.entries(raw.decisions as Record<string, unknown>)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= rows.length || (v !== "import" && v !== "skip")) return { error: "One of the row choices is not valid." };
      decisions[i] = v;
    }
  }

  const filename = typeof raw.filename === "string" ? raw.filename.replace(/[\u0000-\u001f]/g, "").slice(0, 200) : "";
  return {
    value: {
      filename,
      headers: headers as string[],
      rows: rows as string[][],
      targets: raw.targets as string[],
      defaults: { category_id: category_id as string | null, assigned_to: assigned_to as string | null, priority: priority as Priority | null, source: source === null ? null : (source as string).trim() },
      decisions,
      confirmed: raw.confirmed === true,
    },
  };
}
