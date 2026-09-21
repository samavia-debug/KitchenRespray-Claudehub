const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT = "KitchenRespray-Monitoring/1.0 (+website health check)";

export type SeoCheckResult = {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  hasNoindex: boolean;
  robotsTxtStatus: "found" | "missing" | "error";
  robotsDisallowsAll: boolean;
  sitemapStatus: "found" | "missing" | "error";
  sitemapInRobots: boolean;
};

async function fetchText(url: string): Promise<{ status: number | null; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch {
    return { status: null, body: "" };
  } finally {
    clearTimeout(timeout);
  }
}

function extractTag(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Homepage + robots.txt + sitemap.xml only — a technical-SEO spot-check,
 * not a crawler. Every field here is either read directly off a response
 * or explicitly null/unknown; nothing is inferred or guessed.
 */
export async function checkSeo(domain: string): Promise<SeoCheckResult> {
  const baseUrl = `https://${domain}`;

  const [homepage, robots, sitemap] = await Promise.all([
    fetchText(baseUrl),
    fetchText(`${baseUrl}/robots.txt`),
    fetchText(`${baseUrl}/sitemap.xml`),
  ]);

  const html = homepage.body;
  const title = extractTag(html, /<title[^>]*>([^<]*)<\/title>/i);
  const metaDescription = extractTag(
    html,
    /<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i
  );
  const canonicalUrl = extractTag(html, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
  const robotsMeta = extractTag(html, /<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const hasNoindex = robotsMeta ? /noindex/i.test(robotsMeta) : false;

  const robotsTxtStatus: SeoCheckResult["robotsTxtStatus"] =
    robots.status === null ? "error" : robots.status === 200 ? "found" : "missing";
  const robotsDisallowsAll = robots.status === 200 && /user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\n|$)/i.test(robots.body);
  const sitemapInRobots = robots.status === 200 && /^sitemap:/im.test(robots.body);

  const sitemapStatus: SeoCheckResult["sitemapStatus"] =
    sitemap.status === null ? "error" : sitemap.status === 200 ? "found" : "missing";

  return {
    title,
    metaDescription,
    canonicalUrl,
    hasNoindex,
    robotsTxtStatus,
    robotsDisallowsAll,
    sitemapStatus,
    sitemapInRobots,
  };
}

export type DomainExpiryResult = {
  expiresAt: string | null;
  unavailable: boolean;
  errorMessage: string | null;
};

/**
 * RDAP (the modern, free, no-API-key replacement for WHOIS) via rdap.org's
 * public bootstrap proxy — it looks up the right registry automatically.
 * Not every registry (particularly some ccTLDs, e.g. many .ie domains)
 * publishes RDAP data, so "unavailable" is an expected, honest outcome,
 * not an error to retry.
 */
export async function checkDomainExpiry(domain: string): Promise<DomainExpiryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/rdap+json", "User-Agent": USER_AGENT },
      cache: "no-store",
    });

    if (res.status === 404) {
      return { expiresAt: null, unavailable: true, errorMessage: null };
    }
    if (!res.ok) {
      return { expiresAt: null, unavailable: false, errorMessage: `RDAP lookup returned HTTP ${res.status}` };
    }

    const data = await res.json();
    const events: Array<{ eventAction?: string; eventDate?: string }> = data?.events || [];
    const expiryEvent = events.find((e) => e.eventAction === "expiration");

    if (!expiryEvent?.eventDate) {
      return { expiresAt: null, unavailable: true, errorMessage: null };
    }

    return { expiresAt: new Date(expiryEvent.eventDate).toISOString(), unavailable: false, errorMessage: null };
  } catch (err: any) {
    const message = err?.name === "AbortError" ? `Timed out after ${FETCH_TIMEOUT_MS}ms` : err?.message || "RDAP lookup failed";
    return { expiresAt: null, unavailable: false, errorMessage: message };
  } finally {
    clearTimeout(timeout);
  }
}
