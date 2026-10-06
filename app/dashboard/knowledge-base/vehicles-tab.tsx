"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate, RULES, type VehicleOverview } from "@/lib/connecteam/vehicles-summary";

type Payload = { configured: boolean; lastSyncedAt: string | null; reports: number; overview: VehicleOverview };

function ago(iso: string): string {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default function VehiclesTab() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/connecteam/vehicles");
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not load vehicle data");
        return;
      }
      setError(null);
      setData(body);
    } catch (err: any) {
      setError(err.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function syncNow() {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/connecteam/vehicles", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMessage(`Error: ${body.error}`);
      } else {
        setMessage(`Synced ${body.total} inspection reports${body.skipped ? ` (${body.skipped} skipped — no registration entered)` : ""}.`);
        await load();
      }
    } catch (err: any) {
      setMessage(`Error: ${err.message}`);
    }
    setSyncing(false);
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const o = data?.overview;

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>Vehicle inspections</h2>
            <p style={{ color: "var(--muted)", margin: "0.35rem 0 0", fontSize: "0.9rem" }}>
              {data
                ? data.reports > 0
                  ? `${data.reports} reports from Connecteam's weekly driver's inspection form${data.lastSyncedAt ? ` · last synced ${ago(data.lastSyncedAt)}` : ""}`
                  : "Nothing synced yet — click Sync now."
                : tableMissing
                ? "Not set up yet."
                : "Loading..."}
            </p>
          </div>
          <button className="btn" onClick={syncNow} disabled={syncing || tableMissing}>
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
        {message && <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>{message}</p>}
        {error && (
          <p className="error-text" style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
            {tableMissing
              ? "The vehicle_inspections table doesn't exist yet. Run the vehicle_inspections migration in Supabase, then come back and click Sync now."
              : error}
          </p>
        )}
      </div>

      {o && data && data.reports > 0 && (
        <>
          <div className="stat-grid" style={{ marginBottom: "1.25rem" }}>
            <div className="stat-card">
              <div className="stat-value">{o.regularVehicles}</div>
              <div className="stat-label">Regular vehicles</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={o.overdueVehicles > 0 ? { color: "#b3261e" } : undefined}>
                {o.overdueVehicles}
              </div>
              <div className="stat-label">No report in {RULES.overdueAfterDays}+ days</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={o.missingDrivers.length > 0 ? { color: "#b98900" } : undefined}>
                {o.missingDrivers.length} <span style={{ fontSize: "1rem", color: "var(--muted)" }}>of {o.regularDrivers.length}</span>
              </div>
              <div className="stat-label">Drivers not submitted this week</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {o.totals.reports7} <span style={{ fontSize: "1rem", color: "var(--muted)" }}>/ {o.totals.reports30}</span>
              </div>
              <div className="stat-label">Reports: 7 days / 30 days</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={o.safetyEquipmentMissingOnRegular > 0 ? { color: "#b98900" } : undefined}>
                {o.safetyEquipmentMissingOnRegular}
              </div>
              <div className="stat-label">Regular vans, safety equipment missing</div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Drivers who haven't submitted in the last {RULES.missingWindowDays} days</h2>
            {o.missingDrivers.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>Every regular driver has submitted this week.</p>
            ) : (
              <p style={{ margin: 0 }}>{o.missingDrivers.map((d) => d.name).join(", ")}</p>
            )}
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Vehicles</h2>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Registration</th>
                    <th>Make / model</th>
                    <th>Last report</th>
                    <th>Driver (as typed)</th>
                    <th>Odometer</th>
                    <th>Latest result</th>
                    <th>Defect reports (90d)</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {o.vehicles.map((v) => (
                    <tr key={v.key}>
                      <td>{v.reg}</td>
                      <td>{v.makeModel || "—"}</td>
                      <td>
                        {formatDate(v.lastInspectedAt)}
                        <span style={{ color: v.overdue ? "#b3261e" : "var(--muted)", marginLeft: "0.35rem", fontSize: "0.8rem" }}>
                          {v.daysSince === 0 ? "today" : `${v.daysSince}d ago`}
                        </span>
                      </td>
                      <td>{v.lastDriver || "—"}</td>
                      <td>{v.lastOdometerKm !== null ? v.lastOdometerKm.toLocaleString("en-IE") : "—"}</td>
                      <td>
                        {v.lastDefects.length > 0 || v.lastConditionOk === false ? (
                          <span style={{ color: "#b3261e" }}>
                            {v.lastDefects.length ? v.lastDefects.join(", ") : "Not acceptable"}
                          </span>
                        ) : (
                          <span style={{ color: "#2e7d32" }}>OK</span>
                        )}
                        {v.lastSafetyEquipmentOk === false && (
                          <div style={{ fontSize: "0.75rem", color: "#b98900" }}>Safety equipment missing</div>
                        )}
                      </td>
                      <td>
                        {v.defectReports90} of {v.reports90}
                      </td>
                      <td>
                        {v.overdue ? (
                          <span style={{ color: "#b3261e", fontWeight: 600 }}>Overdue</span>
                        ) : v.regular ? (
                          "Regular"
                        ) : (
                          <span style={{ color: "var(--muted)" }}>Rare / one-off</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <h2 style={{ marginTop: 0 }}>Defect reports — last 60 days</h2>
            {o.recentDefects.length === 0 ? (
              <p style={{ color: "var(--muted)", margin: 0 }}>None.</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Registration</th>
                      <th>Defects ticked</th>
                      <th>Condition acceptable</th>
                      <th>Driver (as typed)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.recentDefects.map((d, i) => (
                      <tr key={i}>
                        <td>{formatDate(d.submittedAt)}</td>
                        <td>{d.reg}</td>
                        <td>{d.defects.length ? d.defects.join(", ") : "—"}</td>
                        <td>{d.conditionOk === null ? "—" : d.conditionOk ? "Yes" : <span style={{ color: "#b3261e" }}>No</span>}</td>
                        <td>{d.driver || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            How this is worked out: a <strong>regular vehicle</strong> has {RULES.regularVehicleMinReports}+ reports in the last{" "}
            {RULES.regularVehicleWindowDays} days; a <strong>regular driver</strong> has submitted at least once in the last{" "}
            {RULES.regularDriverWindowDays} days; a vehicle is <strong>overdue</strong> after {RULES.overdueAfterDays} days with no report.
            Drivers are matched by their Connecteam login, not the name typed on the form, and registrations are matched ignoring
            spaces, dashes and capitals. Odometer readings that are blank or implausible are ignored.
          </p>
        </>
      )}
    </>
  );
}
