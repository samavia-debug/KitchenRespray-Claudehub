import * as tls from "node:tls";

const HTTP_TIMEOUT_MS = 10_000;
const TLS_TIMEOUT_MS = 8_000;
const LINK_TIMEOUT_MS = 6_000;
const LINK_CONCURRENCY = 5;
const MAX_LINKS_CHECKED = 25;
const BODY_SNIPPET_BYTES = 20_000;
const USER_AGENT = "KitchenRespray-Monitoring/1.0 (+website health check)";

export type HealthCheckResult = {
  isUp: boolean;
  httpStatus: number | null;
  responseTimeMs: number;
  sslValid: boolean | null;
  sslExpiresAt: string | null;
  errorMessage: string | null;
  likelyBlocked: boolean;
};

/**
 * A 403 (or similar) to the monitor's own request commonly means a
 * WAF/bot-protection rule is blocking the *monitor*, not that the site is
 * actually broken for real visitors. Flagged as its own signal — purely
 * heuristic (known WAF header/body fingerprints), never claimed as fact.
 */
export function detectLikelyBlocked(status: number | null, headers: Headers | null, bodySnippet: string): boolean {
  if (status !== 403 && status !== 406 && status !== 429 && status !== 503) return false;

  const server = headers?.get("server")?.toLowerCase() || "";
  const via = headers?.get("via")?.toLowerCase() || "";
  const body = bodySnippet.toLowerCase();

  const signals = [
    server.includes("cloudflare") && status === 403,
    headers?.has("cf-mitigated"),
    headers?.has("x-sucuri-id"),
    via.includes("sucuri"),
    /access denied|attention required|please verify you are a human|automated (requests|access)|blocked by/i.test(
      bodySnippet
    ),
    body.includes("cloudflare") && (status === 403 || status === 503),
  ];

  return signals.some(Boolean);
}

async function readBodySnippet(res: Response): Promise<string> {
  try {
    const reader = res.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let snippet = "";
    let received = 0;
    while (received < BODY_SNIPPET_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      snippet += decoder.decode(value, { stream: true });
      received += value.length;
    }
    reader.cancel().catch(() => {});
    return snippet;
  } catch {
    return "";
  }
}

async function checkHttp(domain: string): Promise<{
  isUp: boolean;
  httpStatus: number | null;
  responseTimeMs: number;
  errorMessage: string | null;
  likelyBlocked: boolean;
}> {
  const url = `https://${domain}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    const bodySnippet = await readBodySnippet(res);
    const responseTimeMs = Date.now() - start;
    // A response was received at all — even a 4xx means the server is up.
    // 5xx counts as down: the origin itself is failing.
    return {
      isUp: res.status < 500,
      httpStatus: res.status,
      responseTimeMs,
      errorMessage: null,
      likelyBlocked: detectLikelyBlocked(res.status, res.headers, bodySnippet),
    };
  } catch (err: any) {
    const responseTimeMs = Date.now() - start;
    const message =
      err?.name === "AbortError" ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err?.message || "Request failed";
    return { isUp: false, httpStatus: null, responseTimeMs, errorMessage: message, likelyBlocked: false };
  } finally {
    clearTimeout(timeout);
  }
}

function checkSsl(domain: string): Promise<{ sslValid: boolean | null; sslExpiresAt: string | null }> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = tls.connect(
      { host: domain, port: 443, servername: domain, timeout: TLS_TIMEOUT_MS },
      () => {
        if (settled) return;
        settled = true;
        const cert = socket.getPeerCertificate();
        const sslValid = socket.authorized ?? null;
        const sslExpiresAt = cert && cert.valid_to ? new Date(cert.valid_to).toISOString() : null;
        socket.end();
        resolve({ sslValid, sslExpiresAt });
      }
    );

    socket.on("error", () => {
      if (settled) return;
      settled = true;
      resolve({ sslValid: null, sslExpiresAt: null });
    });

    socket.on("timeout", () => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ sslValid: null, sslExpiresAt: null });
    });
  });
}

/** Probes a domain's HTTP availability and SSL certificate. Node runtime only. */
export async function checkWebsiteHealth(domain: string): Promise<HealthCheckResult> {
  const http = await checkHttp(domain);
  const ssl = await checkSsl(domain);

  return {
    isUp: http.isUp,
    httpStatus: http.httpStatus,
    responseTimeMs: http.responseTimeMs,
    sslValid: ssl.sslValid,
    sslExpiresAt: ssl.sslExpiresAt,
    errorMessage: http.errorMessage,
    likelyBlocked: http.likelyBlocked,
  };
}

export type LinkCheckResult = {
  sourceUrl: string;
  targetUrl: string;
  linkType: "internal" | "external";
  httpStatus: number | null;
  isBroken: boolean;
  errorMessage: string | null;
};

/** Pulls href targets out of raw HTML. Deliberately simple (no DOM parser dependency). */
export function extractLinks(html: string, baseUrl: string): string[] {
  const found = new Set<string>();
  const hrefPattern = /<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefPattern.exec(html))) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith("mailto:") || raw.startsWith("tel:") || raw.startsWith("javascript:")) continue;
    try {
      const resolved = new URL(raw, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      resolved.hash = "";
      found.add(resolved.toString());
    } catch {
      // ignore unparseable hrefs
    }
  }

  return Array.from(found);
}

async function checkOneLink(sourceUrl: string, targetUrl: string, linkType: "internal" | "external"): Promise<LinkCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_TIMEOUT_MS);

  try {
    let res = await fetch(targetUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    // Some servers don't implement HEAD correctly — fall back to GET.
    if (res.status === 405 || res.status === 501) {
      res = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
        cache: "no-store",
      });
    }
    return { sourceUrl, targetUrl, linkType, httpStatus: res.status, isBroken: res.status >= 400, errorMessage: null };
  } catch (err: any) {
    const message = err?.name === "AbortError" ? `Timed out after ${LINK_TIMEOUT_MS}ms` : err?.message || "Request failed";
    return { sourceUrl, targetUrl, linkType, httpStatus: null, isBroken: true, errorMessage: message };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches a site's homepage and checks every distinct link found on it.
 * Homepage-only, bounded to MAX_LINKS_CHECKED, bounded concurrency — a
 * polite spot-check, not a full-site crawl.
 */
export async function checkBrokenLinks(domain: string): Promise<LinkCheckResult[]> {
  const sourceUrl = `https://${domain}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  let html = "";
  try {
    const res = await fetch(sourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    html = await res.text();
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }

  const links = extractLinks(html, sourceUrl).slice(0, MAX_LINKS_CHECKED);
  const homeHost = new URL(sourceUrl).hostname.replace(/^www\./, "");

  const results: LinkCheckResult[] = [];
  for (let i = 0; i < links.length; i += LINK_CONCURRENCY) {
    const batch = links.slice(i, i + LINK_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((target) => {
        const targetHost = new URL(target).hostname.replace(/^www\./, "");
        const linkType = targetHost === homeHost ? "internal" : "external";
        return checkOneLink(sourceUrl, target, linkType);
      })
    );
    results.push(...batchResults);
  }

  return results;
}
