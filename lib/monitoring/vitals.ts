const PSI_TIMEOUT_MS = 45_000; // a real Lighthouse audit runs server-side on Google's end — this is slow by nature

export type MetricRating = "good" | "needs-improvement" | "poor";

export type VitalsResult = {
  performanceScore: number | null; // 0-100
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  hasFieldData: boolean;
  errorMessage: string | null;
};

/**
 * Runs a PageSpeed Insights (mobile) audit for a domain's homepage. Works
 * without any API key — Google allows unauthenticated requests at a lower,
 * shared quota, which is enough for occasional manual per-site checks.
 * Set GOOGLE_PAGESPEED_API_KEY (same Google Cloud project as the OAuth
 * setup, just enable "PageSpeed Insights API" and create an API key
 * credential) for a higher, dedicated quota if this gets rate-limited.
 */
export async function checkCoreWebVitals(domain: string): Promise<VitalsResult> {
  const apiKey = process.env.GOOGLE_PAGESPEED_API_KEY;
  const url = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  url.searchParams.set("url", `https://${domain}`);
  url.searchParams.set("category", "performance");
  url.searchParams.set("strategy", "mobile");
  if (apiKey) url.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PSI_TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal, cache: "no-store" });
    const data = await res.json();

    if (!res.ok) {
      return {
        performanceScore: null,
        lcpMs: null,
        cls: null,
        tbtMs: null,
        hasFieldData: false,
        errorMessage: data?.error?.message || `PageSpeed Insights returned HTTP ${res.status}`,
      };
    }

    const audits = data.lighthouseResult?.audits || {};
    const performanceScore =
      data.lighthouseResult?.categories?.performance?.score != null
        ? Math.round(data.lighthouseResult.categories.performance.score * 100)
        : null;

    return {
      performanceScore,
      lcpMs: audits["largest-contentful-paint"]?.numericValue ?? null,
      cls: audits["cumulative-layout-shift"]?.numericValue ?? null,
      tbtMs: audits["total-blocking-time"]?.numericValue ?? null,
      hasFieldData: !!data.loadingExperience?.metrics,
      errorMessage: null,
    };
  } catch (err: any) {
    const message =
      err?.name === "AbortError" ? `Timed out after ${PSI_TIMEOUT_MS}ms` : err?.message || "PageSpeed Insights request failed";
    return { performanceScore: null, lcpMs: null, cls: null, tbtMs: null, hasFieldData: false, errorMessage: message };
  } finally {
    clearTimeout(timeout);
  }
}

// Google's official Core Web Vitals thresholds for LCP/CLS; TBT is a lab
// proxy for INP (INP itself needs real-user field data most small sites
// don't have enough traffic to report) using Lighthouse's own scoring
// bands — not one of the 3 official Core Web Vitals, but the closest lab
// signal available without field data.
export function rateLcp(ms: number | null): MetricRating | null {
  if (ms === null) return null;
  if (ms <= 2500) return "good";
  if (ms <= 4000) return "needs-improvement";
  return "poor";
}

export function rateCls(value: number | null): MetricRating | null {
  if (value === null) return null;
  if (value <= 0.1) return "good";
  if (value <= 0.25) return "needs-improvement";
  return "poor";
}

export function rateTbt(ms: number | null): MetricRating | null {
  if (ms === null) return null;
  if (ms <= 200) return "good";
  if (ms <= 600) return "needs-improvement";
  return "poor";
}
