import Link from "next/link";
import type { WebsiteWithHealth } from "@/lib/monitoring/types";
import { describeStatus } from "@/lib/monitoring/alerts";

export default function AlertsPanel({ websites }: { websites: WebsiteWithHealth[] }) {
  const critical = websites
    .filter((w) => w.status === "critical" || w.status === "offline")
    .sort((a, b) => (a.status === "offline" ? -1 : 1));

  return (
    <div className="card">
      <h2>Critical alerts</h2>
      {critical.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          No critical issues across your monitored websites.
        </p>
      ) : (
        critical.map((w) => (
          <Link
            key={w.id}
            href={`/dashboard/monitoring/${w.id}`}
            style={{
              display: "block",
              textDecoration: "none",
              color: "inherit",
              padding: "0.65rem 0",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <strong style={{ fontSize: "0.9rem" }}>{w.name}</strong>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>
              {" "}
              — {describeStatus(w.status, w.latestCheck)}
            </span>
          </Link>
        ))
      )}
    </div>
  );
}
