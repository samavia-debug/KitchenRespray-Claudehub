/**
 * Matches monitored website domains to the GA4 properties / Search Console
 * sites a connected Google account has access to, by comparing the
 * "core" name (domain with protocol/www/TLD/punctuation stripped) — GA4
 * property display names and Search Console site URLs are both commonly
 * just the domain in slightly different shapes ("bathrespray" vs
 * "https://bathrespray.com/"), so this normalization is enough to match
 * reliably without needing the account owner to manually map every site.
 */
export function domainCore(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^sc-domain:/, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/, "")
    .replace(/[^a-z0-9]/g, "");
}

export type Ga4PropertySummary = {
  property: string; // "properties/123456"
  displayName: string;
};

export type SearchConsoleSite = {
  siteUrl: string; // "https://example.com/" or "sc-domain:example.com"
  permissionLevel: string;
};

export function matchGa4Property(
  domain: string,
  properties: Ga4PropertySummary[]
): Ga4PropertySummary | null {
  const core = domainCore(domain);
  return properties.find((p) => domainCore(p.displayName) === core) || null;
}

export function matchSearchConsoleSite(
  domain: string,
  sites: SearchConsoleSite[]
): SearchConsoleSite | null {
  const core = domainCore(domain);
  return sites.find((s) => domainCore(s.siteUrl) === core) || null;
}

export async function listGa4Properties(accessToken: string): Promise<Ga4PropertySummary[]> {
  const res = await fetch("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to list GA4 properties");
  }
  return (data.accountSummaries || []).flatMap((a: any) => a.propertySummaries || []);
}

export async function listSearchConsoleSites(accessToken: string): Promise<SearchConsoleSite[]> {
  const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || "Failed to list Search Console sites");
  }
  return data.siteEntry || [];
}
