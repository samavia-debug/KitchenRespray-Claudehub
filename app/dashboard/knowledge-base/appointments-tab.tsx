"use client";

import { useCallback, useEffect, useState } from "react";
import type { BookingsStatus, RunResult } from "@/lib/bookings/service";
import { ago } from "./ago";

const when = (sec: number) =>
  new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(sec * 1000);

const ACTION: Record<string, { label: string; color?: string }> = {
  create: { label: "Add to Connecteam" },
  update: { label: "Change in Connecteam", color: "#b98900" },
  remove: { label: "Remove from Connecteam", color: "#b3261e" },
  unchanged: { label: "Already in Connecteam", color: "var(--muted)" },
};

function Check({ ok, children, hint }: { ok: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div style={{ display: "flex", gap: "0.6rem", alignItems: "baseline", marginBottom: "0.4rem" }}>
      <span style={{ color: ok ? "#2e7d32" : "#b3261e", fontWeight: 700, width: "1.1rem" }}>{ok ? "✓" : "✗"}</span>
      <div>
        {children}
        {!ok && hint && <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{hint}</div>}
      </div>
    </div>
  );
}

export default function AppointmentsTab() {
  const [status, setStatus] = useState<BookingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState<null | "preview" | "copy">(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bookings/sync");
      const body = await res.json();
      if (!res.ok) setError(body.error || "Could not load the status");
      else {
        setError(null);
        setStatus(body);
      }
    } catch (e: any) {
      setError(e.message || "Network error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(apply: boolean) {
    if (apply && !window.confirm("Copy upcoming website appointments into the Showroom Appointment calendar in Connecteam now?")) return;
    setBusy(apply ? "copy" : "preview");
    setResult(null);
    try {
      const res = await fetch("/api/bookings/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apply }) });
      const body = await res.json();
      if (!res.ok) setResult({ state: "error", message: body.error || "Failed", writeEnabled: false, held: [], errors: [], skippedAppointments: 0 });
      else setResult(body);
      if (apply) await load();
    } catch (e: any) {
      setResult({ state: "error", message: e.message || "Network error", writeEnabled: false, held: [], errors: [], skippedAppointments: 0 });
    }
    setBusy(null);
  }

  const tableMissing = !!error && /does not exist|could not find the table|schema cache/i.test(error);
  const last = status?.lastResult;

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <h2 style={{ marginTop: 0 }}>Website appointments in Connecteam</h2>
        <p style={{ color: "var(--muted)", margin: "0 0 1rem", fontSize: "0.9rem" }}>
          Appointments booked on the website (Microsoft Bookings) can be copied into the <strong>Showroom Appointment</strong> calendar in Connecteam, so the team sees them
          there. It checks for new, changed and cancelled bookings every 30 minutes once it is switched on. Only the showroom, the time and the customer&apos;s first name are
          copied. That calendar is left out of the lateness, hours and rota figures.
        </p>

        {tableMissing && <p className="error-text">The tables for this are not set up yet. Run the booking_shift_links migration in Supabase, then reload.</p>}
        {error && !tableMissing && <p className="error-text">{error}</p>}
        {!status && !error && <p style={{ color: "var(--muted)" }}>Loading...</p>}

        {status && (
          <>
            <Check ok={status.microsoftConfigured} hint="Needs the Microsoft details from your Microsoft 365 admin (see below). Nothing is read until then.">
              Microsoft Bookings is connected
            </Check>
            <Check ok={status.connecteamConfigured} hint="CONNECTEAM_API_KEY is not set.">
              Connecteam is connected
            </Check>
            <Check ok={status.writeEnabled} hint="Writing to Connecteam is off. You can still preview. It is switched on with BOOKINGS_TO_CONNECTEAM_ENABLED=true once a test has been checked.">
              Copying into Connecteam is switched on
            </Check>
            <p style={{ margin: "0.6rem 0 0", fontSize: "0.9rem" }}>
              Appointments appear as <strong>{status.assignedTo === "people" ? "shifts assigned to the chosen people" : "open (unassigned) shifts"}</strong>. {status.linked} copied so far
              {status.lastRunAt ? `, last run ${ago(status.lastRunAt)}` : ", not run yet"}.
            </p>
            {status.alsoCopiesTo.length > 0 && (
              <p style={{ margin: "0.3rem 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
                Also copied into: {status.alsoCopiesTo.join(", ")}. Only appointments with a person assigned go there, never open shifts, and they are left out of the lateness, hours and
                rota figures.
              </p>
            )}
            {last && (
              <p style={{ margin: "0.3rem 0 0", fontSize: "0.82rem", color: last.errors?.length ? "#b3261e" : "var(--muted)" }}>
                Last run: {last.state}
                {last.counts ? ` · ${last.counts.create} added, ${last.counts.update} changed, ${last.counts.remove} removed` : ""}
                {last.errors?.length ? ` · ${last.errors.length} problem${last.errors.length === 1 ? "" : "s"}` : ""}
                {last.held?.length ? ` · ${last.held.length} held back for safety` : ""}
              </p>
            )}

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
              <button className="btn btn-secondary" onClick={() => run(false)} disabled={busy !== null || !status.microsoftConfigured || !status.connecteamConfigured}>
                {busy === "preview" ? "Checking..." : "Preview what would be copied"}
              </button>
              <button className="btn" onClick={() => run(true)} disabled={busy !== null || !status.microsoftConfigured || !status.writeEnabled}>
                {busy === "copy" ? "Copying..." : "Copy now"}
              </button>
            </div>
          </>
        )}
      </div>

      {result && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ marginTop: 0 }}>{result.state === "applied" ? "Copied" : result.state === "preview" ? "Preview (nothing was changed)" : "Result"}</h2>
          {result.message && <p style={{ color: result.state === "error" || result.state === "not_configured" || result.state === "busy" ? "#b3261e" : undefined }}>{result.message}</p>}
          {result.counts && (
            <p style={{ margin: "0 0 0.75rem" }}>
              {result.counts.create + result.counts.update + result.counts.remove === 0
                ? `Nothing to change: all ${result.counts.unchanged} upcoming appointment${result.counts.unchanged === 1 ? " is" : "s are"} already in Connecteam.`
                : `${result.counts.create} to add · ${result.counts.update} to change · ${result.counts.remove} to remove · ${result.counts.unchanged} already there`}
              {result.state === "applied" ? ` · ${result.counts.done} done` : ""}
              {result.skippedAppointments > 0 ? ` · ${result.skippedAppointments} appointment${result.skippedAppointments === 1 ? "" : "s"} skipped because the time could not be read` : ""}
            </p>
          )}
          {result.extras?.map((x) => (
            <p key={x.schedulerId} style={{ margin: "0 0 0.75rem", fontSize: "0.9rem" }}>
              <strong>Also in {x.name}:</strong>{" "}
              {x.counts.create + x.counts.update + x.counts.remove === 0
                ? `nothing to change (${x.counts.unchanged} already there)`
                : `${x.counts.create} to add · ${x.counts.update} to change · ${x.counts.remove} to remove · ${x.counts.unchanged} already there`}
              {result.state === "applied" ? ` · ${x.counts.done} done` : ""}
              {x.skippedOpen > 0 ? ` · ${x.skippedOpen} not copied there because nobody is assigned` : ""}
            </p>
          ))}
          {result.held.map((h) => (
            <p key={h} style={{ color: "#b98900", fontSize: "0.9rem" }}>
              {h}
            </p>
          ))}
          {result.errors.map((e, i) => (
            <p key={i} className="error-text" style={{ margin: "0.25rem 0" }}>
              {e}
            </p>
          ))}
          {result.items && result.items.length > 0 && (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Showroom</th>
                    <th>When (Irish time)</th>
                    <th>First name</th>
                    <th>Assigned to</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((it, i) => (
                    <tr key={i}>
                      <td style={{ color: ACTION[it.action]?.color, fontWeight: 600 }}>{ACTION[it.action]?.label}</td>
                      <td>{it.service || "—"}</td>
                      <td>{when(it.startSec)}</td>
                      <td>{it.firstName ?? "—"}</td>
                      <td>{it.assignedTo || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.items && result.items.length === 0 && result.counts && (
            <p style={{ color: "var(--muted)", margin: 0 }}>No upcoming appointments were found in Microsoft Bookings, so there is nothing to copy.</p>
          )}
        </div>
      )}
    </>
  );
}
