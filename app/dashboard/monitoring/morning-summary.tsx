import Link from "next/link";
import type { WebsiteWithHealth, Incident } from "@/lib/monitoring/types";
import { formatDuration } from "@/lib/monitoring/incidents";
import CheckAllButton from "./check-all-button";

const OVERNIGHT_WINDOW_HOURS = 24;
const STALE_INCIDENT_HOURS = 24;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The "answer in under 30 seconds" view — spec's own success criteria:
 * are all sites online, what's urgent, what happened overnight, what's
 * been unresolved too long. Deliberately narrative/glanceable — the
 * Priority Alerts panel below already has the full findings/recommended-
 * actions detail per site, this is the digest above it, not a duplicate.
 */
export default function MorningSummary({
  websites,
  recentIncidents,
  canManage,
  onChecked,
}: {
  websites: WebsiteWithHealth[];
  recentIncidents: Incident[];
  canManage: boolean;
  onChecked: () => void;
}) {
  const total = websites.length;
  const healthy = websites.filter((w) => w.status === "healthy").length;
  const attention = websites.filter((w) => w.status === "attention").length;
  const openNow = websites.filter((w) => w.openIncident).length;

  const overnightCutoff = Date.now() - OVERNIGHT_WINDOW_HOURS * 60 * 60 * 1000;
  const openedOvernight = recentIncidents.filter((i) => new Date(i.started_at).getTime() >= overnightCutoff);
  const resolvedOvernight = recentIncidents.filter(
    (i) => i.resolved_at && new Date(i.resolved_at).getTime() >= overnightCutoff
  );

  const staleCutoff = Date.now() - STALE_INCIDENT_HOURS * 60 * 60 * 1000;
  const staleOpen = websites
    .filter((w) => w.openIncident && new Date(w.openIncident.started_at).getTime() <= staleCutoff)
    .sort((a, b) => new Date(a.openIncident!.started_at).getTime() - new Date(b.openIncident!.started_at).getTime());

  const activeIncidents = websites
    .filter((w) => w.openIncident)
    .sort((a, b) => new Date(a.openIncident!.started_at).getTime() - new Date(b.openIncident!.started_at).getTime());

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ margin: 0 }}>{greeting()} — Website Health Summary</h2>
        {canManage && <CheckAllButton onChecked={onChecked} label="Scan all sites now" />}
      </div>

      <p style={{ fontSize: "0.95rem", margin: "0.75rem 0 0" }}>
        <strong>{total}</strong> websites monitored — <strong style={{ color: "var(--healthy, #2e7d32)" }}>{healthy} healthy</strong>,{" "}
        <strong style={{ color: "#b98900" }}>{attention} need attention</strong>,{" "}
        <strong style={{ color: "#b3261e" }}>{openNow} critical incident{openNow === 1 ? "" : "s"} active</strong>.
      </p>

      {(openedOvernight.length > 0 || resolvedOvernight.length > 0) && (
        <p style={{ color: "var(--muted)", fontSize: "0.87rem", margin: "0.5rem 0 0" }}>
          In the last {OVERNIGHT_WINDOW_HOURS}h: {openedOvernight.length} new incident{openedOvernight.length === 1 ? "" : "s"},{" "}
          {resolvedOvernight.length} resolved.
        </p>
      )}

      {staleOpen.length > 0 && (
        <div style={{ marginTop: "0.9rem", padding: "0.65rem 0.9rem", background: "var(--critical-soft, #fbe6e4)", border: "1px solid #b3261e", borderRadius: "10px" }}>
          <strong style={{ fontSize: "0.87rem", color: "#b3261e" }}>
            {staleOpen.length} incident{staleOpen.length === 1 ? "" : "s"} unresolved for over {STALE_INCIDENT_HOURS}h
          </strong>
          {staleOpen.map((w) => (
            <div key={w.id} style={{ fontSize: "0.85rem", marginTop: "0.3rem" }}>
              <Link href={`/dashboard/monitoring/${w.id}`}>{w.name}</Link> — down {formatDuration(w.openIncident!.started_at, null)}
            </div>
          ))}
        </div>
      )}

      {activeIncidents.length > 0 ? (
        <div style={{ marginTop: "0.9rem" }}>
          <h3 style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>Critical right now</h3>
          {activeIncidents.slice(0, 5).map((w) => (
            <Link
              key={w.id}
              href={`/dashboard/monitoring/${w.id}`}
              style={{ display: "block", textDecoration: "none", color: "inherit", padding: "0.35rem 0", fontSize: "0.87rem" }}
            >
              {w.status === "offline" ? "🔴" : "🟠"} <strong>{w.name}</strong>{" "}
              <span style={{ color: "var(--muted)" }}>
                — {w.status} for {formatDuration(w.openIncident!.started_at, null)}
              </span>
            </Link>
          ))}
          {activeIncidents.length > 5 && (
            <Link href="/dashboard/incidents" style={{ fontSize: "0.82rem", color: "var(--accent)", fontWeight: 600 }}>
              +{activeIncidents.length - 5} more →
            </Link>
          )}
        </div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: "0.87rem", margin: "0.75rem 0 0" }}>
          No active incidents. All critical/offline-tier issues are clear.
        </p>
      )}
    </div>
  );
}
