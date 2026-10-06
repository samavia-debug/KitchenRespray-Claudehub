/**
 * Reads every row of a query, a page at a time.
 *
 * Supabase caps each request at 1,000 rows no matter what `.limit()` says,
 * so a bare `.limit(5000)` silently returns only the first 1,000. The query
 * must have a stable order that is unique per row (end it with the primary
 * key), or a row can be skipped or repeated between pages.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 100_000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
