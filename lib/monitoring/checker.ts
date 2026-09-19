import * as tls from "node:tls";

const HTTP_TIMEOUT_MS = 10_000;
const TLS_TIMEOUT_MS = 8_000;

export type HealthCheckResult = {
  isUp: boolean;
  httpStatus: number | null;
  responseTimeMs: number;
  sslValid: boolean | null;
  sslExpiresAt: string | null;
  errorMessage: string | null;
};

async function checkHttp(
  domain: string
): Promise<{ isUp: boolean; httpStatus: number | null; responseTimeMs: number; errorMessage: string | null }> {
  const url = `https://${domain}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "KitchenRespray-Monitoring/1.0 (+website health check)" },
      cache: "no-store",
    });
    const responseTimeMs = Date.now() - start;
    // A response was received at all — even a 4xx means the server is up.
    // 5xx counts as down: the origin itself is failing.
    return { isUp: res.status < 500, httpStatus: res.status, responseTimeMs, errorMessage: null };
  } catch (err: any) {
    const responseTimeMs = Date.now() - start;
    const message =
      err?.name === "AbortError" ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err?.message || "Request failed";
    return { isUp: false, httpStatus: null, responseTimeMs, errorMessage: message };
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
  };
}
