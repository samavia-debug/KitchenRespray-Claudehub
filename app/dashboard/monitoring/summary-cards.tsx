import type { WebsiteWithHealth } from "@/lib/monitoring/types";

export default function SummaryCards({ websites }: { websites: WebsiteWithHealth[] }) {
  const total = websites.length;
  const healthy = websites.filter((w) => w.status === "healthy").length;
  const attention = websites.filter((w) => w.status === "attention").length;
  const critical = websites.filter((w) => w.status === "critical").length;
  const offline = websites.filter((w) => w.status === "offline").length;

  const responseTimes = websites
    .map((w) => w.latestCheck?.response_time_ms)
    .filter((v): v is number => typeof v === "number");
  const avgResponse =
    responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : null;

  return (
    <div className="stat-grid">
      <div className="stat-card">
        <div className="stat-value">{total}</div>
        <div className="stat-label">Total websites</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: "#2e7d32" }}>
          {healthy}
        </div>
        <div className="stat-label">Healthy</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: "#b98900" }}>
          {attention}
        </div>
        <div className="stat-label">Needs attention</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: "#b3261e" }}>
          {critical}
        </div>
        <div className="stat-label">Critical</div>
      </div>
      <div className="stat-card">
        <div className="stat-value" style={{ color: "#6f6a63" }}>
          {offline}
        </div>
        <div className="stat-label">Offline</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{avgResponse !== null ? `${avgResponse}ms` : "—"}</div>
        <div className="stat-label">Avg. response time</div>
      </div>
    </div>
  );
}
