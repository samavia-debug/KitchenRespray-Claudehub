"use client";

import Link from "next/link";
import { useCrm } from "../crm-context";
import { Controls, ReportControls, TerritoryTable, useControls, useReport } from "../report-ui";
import SpecialsSection, { useSpecials } from "../specials-section";

export default function TerritoriesPage() {
  const { meta } = useCrm();
  const [controls, setControls] = useControls();
  const { report, error, loading } = useReport(controls);
  const isOverseer = meta?.role === "Admin" || meta?.role === "Manager";
  const sp = useSpecials(isOverseer);
  const everywhere = sp.specials.filter((x) => x.county === null && x.active && x.starts_on <= sp.today && (!x.ends_on || x.ends_on >= sp.today));

  if (!controls) return <p style={{ color: "var(--muted)" }}>Loading...</p>;

  const noCounty = report?.byCounty.find((r) => r.key === "none");

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Territories{report ? `: ${report.range.label}` : ""}</h2>
        <p style={{ margin: "0 0 0.9rem", fontSize: "0.88rem", color: "var(--muted)" }}>
          Every county in Leinster side by side. Click a county to see its companies. Companies, follow-ups and open opportunities show how things stand now; contacts, additions and sales are for the period you choose.
        </p>
        <ReportControls value={controls} onChange={(c: Controls) => setControls(c)} />
        {error && <p className="error-text">{error}</p>}
        {meta?.role === "Staff" && controls.staff === meta.me && (
          <p style={{ margin: "0 0 0.4rem", fontSize: "0.82rem", color: "#8a6700" }}>Showing your own work. Choose Everyone under Person to see the whole team.</p>
        )}
      </div>

      <div className="card" style={{ opacity: loading ? 0.6 : 1 }}>
        {everywhere.length > 0 && (
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.88rem" }}>
            <strong>Running in every county:</strong> {everywhere.map((x) => x.title).join(", ")}
          </p>
        )}
        {report ? <TerritoryTable rows={report.byCounty} specials={sp.specials} today={sp.today} /> : <p style={{ color: "var(--muted)", margin: 0 }}>Loading...</p>}
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
          Estimated values on open opportunities are guesses, never counted as sales. Confirmed sales are the values recorded when a deal was marked Won.
        </p>
      </div>

      <SpecialsSection specials={sp.specials} results={sp.results} today={sp.today} reload={sp.reload} canEdit={isOverseer} />
      {sp.error && <p className="error-text">{sp.error}</p>}

      {noCounty && noCounty.companies > 0 && (
        <div className="card">
          <strong>{noCounty.companies} compan{noCounty.companies === 1 ? "y has" : "ies have"} no county set.</strong>
          <p style={{ margin: "0.35rem 0 0", fontSize: "0.88rem" }}>
            They do not show under any county above.{" "}
            <Link href="/dashboard/crm/companies?county=none">See them</Link>, tick the ones you want, and use <em>Set county</em> to fix them in one go.
          </p>
        </div>
      )}
    </>
  );
}
