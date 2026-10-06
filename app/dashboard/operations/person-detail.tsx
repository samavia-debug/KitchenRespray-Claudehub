"use client";

import { useEffect, useState } from "react";
import { formatKey } from "@/lib/connecteam/time-clock-summary";
import type { PersonDetail } from "@/lib/connecteam/operations";
import { clockTime } from "./format";

export default function PersonDetailPanel({ userId }: { userId: number }) {
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetch(`/api/operations/person?userId=${userId}`)
      .then(async (res) => {
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(body.error || "Could not load this person");
        else setDetail(body);
      })
      .catch((err) => !cancelled && setError(err.message || "Network error"));
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (error) return <p className="error-text" style={{ margin: 0 }}>{error}</p>;
  if (!detail) return <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>;

  const t = detail.totals;
  return (
    <div>
      <p style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
        <strong>Last {detail.days.length} days:</strong> {t.daysWorked} days worked · {t.hours.toFixed(1)}h
        {t.avgHoursPerDay !== null && ` (${t.avgHoursPerDay.toFixed(1)}h a day)`} ·{" "}
        <span style={t.lateCount > 0 ? { color: "#b98900" } : undefined}>
          {t.lateCount} late{t.avgLateMinutes !== null && ` (about ${t.avgLateMinutes} min)`}
        </span>{" "}
        · <span style={t.forgottenClockOuts30d > 0 ? { color: "#b3261e" } : undefined}>{t.forgottenClockOuts30d} forgotten clock-outs in 30 days</span> ·
        vehicle checks in 60 days: {detail.vehicleChecks60d.count}
        {detail.vehicleChecks60d.lastDate && ` (last ${formatKey(detail.vehicleChecks60d.lastDate.slice(0, 10))})`} · open PPE requests: {detail.ppeOpen}
      </p>
      {detail.upcomingLeave.length > 0 && (
        <p style={{ margin: "0 0 0.75rem", fontSize: "0.85rem", color: "var(--muted)" }}>
          Upcoming leave: {detail.upcomingLeave.map((l) => `${l.leaveType} ${formatKey(l.startDate)}${l.startDate === l.endDate ? "" : ` to ${formatKey(l.endDate)}`}`).join("; ")}
        </p>
      )}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Scheduled</th>
              <th>In</th>
              <th>Out</th>
              <th>Hours</th>
              <th>Late</th>
              <th>Job type</th>
              <th>Checklist</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {detail.days.map((d) => (
              <tr key={d.date} style={!d.clockedInAt ? { color: "var(--muted)" } : undefined}>
                <td>{formatKey(d.date)}</td>
                <td>{d.scheduledStart ? clockTime(d.scheduledStart) : "—"}</td>
                <td>{d.clockedInAt ? clockTime(d.clockedInAt) : "—"}</td>
                <td>{d.clockedOutAt ? clockTime(d.clockedOutAt) : "—"}</td>
                <td>{d.hours > 0 ? d.hours.toFixed(1) : "—"}</td>
                <td style={d.lateMinutes !== null && d.lateMinutes > 10 ? { color: "#b98900" } : undefined}>
                  {d.lateMinutes === null ? "—" : d.lateMinutes > 0 ? `+${d.lateMinutes} min` : `${d.lateMinutes} min`}
                </td>
                <td>{d.job ?? "—"}</td>
                <td>{d.tasksTotal > 0 ? `${d.tasksDone}/${d.tasksTotal}` : "—"}</td>
                <td style={d.note === "Never clocked out" || d.note === "Scheduled, no clock-in" ? { color: "#b3261e" } : undefined}>{d.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
