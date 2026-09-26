/**
 * Site-hijack detection — built after finding respraymykitchen.ie's
 * hosting/DNS still legitimate and active, but its homepage silently
 * serving an unrelated Indonesian gambling site. That pattern (domain and
 * hosting fine, content replaced) is the signature of a compromised
 * WordPress install, not an expired domain — so the check that actually
 * catches it is: did the homepage end up on a different domain, and does
 * its content match known spam/gambling keywords.
 */

// Deliberately narrow and specific rather than a huge generic blocklist —
// false positives here would train the team to ignore the alert. Mostly
// Indonesian/Southeast Asian online-gambling spam terms, since that's the
// real pattern observed, plus a couple of generic hacked-site signatures.
const SUSPICIOUS_KEYWORDS = [
  "slot gacor",
  "situs slot",
  "judi online",
  "togel",
  "live casino",
  "rtp slot",
  "daftar slot",
  "agen slot",
  "bandar togel",
  "slot777",
  "maxwin",
  "sabung ayam",
  "hacked by",
  "this site has been hacked",
];

export type SecurityCheckResult = {
  finalUrl: string | null;
  domainMismatch: boolean;
  flaggedKeywords: string[];
  riskLevel: "none" | "suspicious" | "critical";
  errorMessage: string | null;
};

function sameSite(expectedDomain: string, finalHostname: string): boolean {
  const expected = expectedDomain.toLowerCase().replace(/^www\./, "");
  const final = finalHostname.toLowerCase().replace(/^www\./, "");
  return final === expected || final.endsWith(`.${expected}`);
}

export async function checkWebsiteSecurity(domain: string): Promise<SecurityCheckResult> {
  try {
    const response = await fetch(`https://${domain}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KitchenRespray-SecurityScan/1.0)" },
    });

    const finalUrl = response.url;
    let domainMismatch = false;
    try {
      domainMismatch = !sameSite(domain, new URL(finalUrl).hostname);
    } catch {
      // Malformed final URL — treat as a mismatch rather than silently passing.
      domainMismatch = true;
    }

    const html = (await response.text()).toLowerCase();
    const flaggedKeywords = SUSPICIOUS_KEYWORDS.filter((k) => html.includes(k));

    const riskLevel: SecurityCheckResult["riskLevel"] =
      domainMismatch || flaggedKeywords.length > 0 ? (domainMismatch ? "critical" : "suspicious") : "none";

    return { finalUrl, domainMismatch, flaggedKeywords, riskLevel, errorMessage: null };
  } catch (err: any) {
    return { finalUrl: null, domainMismatch: false, flaggedKeywords: [], riskLevel: "none", errorMessage: err.message || "Request failed" };
  }
}
