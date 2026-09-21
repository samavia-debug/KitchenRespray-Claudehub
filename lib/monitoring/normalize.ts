/**
 * Normalizes a user-entered domain/URL so that "https://example.com/",
 * "example.com", and "www.example.com" all resolve to the same monitored
 * website instead of creating duplicate rows.
 */
export function normalizeDomain(input: string): string {
  let value = input.trim().toLowerCase();

  value = value.replace(/^[a-z]+:\/\//, ""); // strip protocol
  value = value.replace(/[/?#].*$/, ""); // strip path/query/hash
  value = value.replace(/:\d+$/, ""); // strip port
  value = value.replace(/^www\./, ""); // strip www subdomain

  return value;
}
