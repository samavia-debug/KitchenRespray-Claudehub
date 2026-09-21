import Link from "next/link";
import type { WebsiteWithHealth } from "@/lib/monitoring/types";
import { getFindings, priorityScore } from "@/lib/monitoring/recommendations";

/**
 * "Needs action now" — every site with a real finding (not just critical/
 * offline: attention-level findings like a near-expiry SSL or a likely WAF
 * block belong here too), ranked by site priority x status severity so the
 * top of the list is always what to look at first.
 */
export default function AlertsPanel({ websites }: { websites: WebsiteWithHealth[] }) {
  const ranked = websites
    .filter((w) => w.status !== "healthy" && w.status !== "unknown")
    .map((w) => ({ website: w, findings: getFindings(w.status, w.latestCheck), score: priorityScore(w.priority, w.status) }))
    .sort((a, b) => b.score - a.score);

  const withBrokenLinks = websites.filter((w) => w.brokenLinkCount > 0);

  return (
    <div className="card">
      <h2>Priority alerts — needs action now</h2>
      {ranked.length === 0 && withBrokenLinks.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          No open issues across your monitored websites.
        </p>
      ) : (
        <>
          {ranked.map(({ website: w, findings }) => (
            <Link
              key={w.id}
              href={`/dashboard/monitoring/${w.id}`}
              style={{
                display: "block",
                textDecoration: "none",
                color: "inherit",
                padding: "0.75rem 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "baseline" }}>
                <strong style={{ fontSize: "0.92rem" }}>{w.name}</strong>
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.03em",
                    color: "var(--muted)",
                  }}
                >
                  {w.priority} priority
                </span>
              </div>
              {findings.map((f, i) => (
                <div key={i} style={{ marginTop: "0.35rem" }}>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--ink)" }}>{f.finding}</p>
                  {f.recommendedActions.length > 0 && (
                    <ul style={{ margin: "0.25rem 0 0", paddingLeft: "1.1rem" }}>
                      {f.recommendedActions.map((a, j) => (
                        <li key={j} style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                          {a}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </Link>
          ))}

          {withBrokenLinks.length > 0 && (
            <div style={{ marginTop: ranked.length > 0 ? "0.9rem" : 0 }}>
              <h3 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Broken links detected</h3>
              {withBrokenLinks.map((w) => (
                <Link
                  key={w.id}
                  href={`/dashboard/monitoring/${w.id}`}
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                    padding: "0.5rem 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "0.87rem",
                  }}
                >
                  <strong>{w.name}</strong>
                  <span style={{ color: "var(--muted)" }}>
                    {" "}
                    — {w.brokenLinkCount} broken link{w.brokenLinkCount === 1 ? "" : "s"} on the homepage
                  </span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
