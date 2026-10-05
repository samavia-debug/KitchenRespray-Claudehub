"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CONNECTEAM_SOURCE, parseStaffContent, type StaffDetails } from "@/lib/connecteam/mapping";
import ConnecteamCard from "./connecteam-card";

type Person = { id: string; name: string; details: StaffDetails };

// Department / team / branch can hold several values ("Admin, Accounts").
function splitValues(value: string | undefined): string[] {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
}

export default function StaffTab() {
  const supabase = createClient();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [team, setTeam] = useState("");
  const [branch, setBranch] = useState("");
  const [showFormer, setShowFormer] = useState(false);

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("knowledge_entries")
      .select("id, title, content")
      .eq("external_source", CONNECTEAM_SOURCE)
      .order("title", { ascending: true });

    if (loadError) {
      setError(loadError.message);
      return;
    }
    setPeople((data || []).map((e) => ({ id: e.id, name: e.title, details: parseStaffContent(e.content) })));
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const options = useMemo(() => {
    const collect = (pick: (d: StaffDetails) => string | undefined) =>
      Array.from(new Set((people || []).flatMap((p) => splitValues(pick(p.details))))).sort((a, b) => a.localeCompare(b));
    return {
      departments: collect((d) => d.department),
      teams: collect((d) => d.team),
      branches: collect((d) => d.branch),
    };
  }, [people]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (people || []).filter((p) => {
      const d = p.details;
      if (d.former && !showFormer) return false;
      if (department && !splitValues(d.department).includes(department)) return false;
      if (team && !splitValues(d.team).includes(team)) return false;
      if (branch && !splitValues(d.branch).includes(branch)) return false;
      if (!q) return true;
      return [p.name, d.jobTitle, d.role, d.department, d.team, d.branch, d.manager, d.email, d.phone]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [people, search, department, team, branch, showFormer]);

  const currentCount = (people || []).filter((p) => !p.details.former).length;
  const formerCount = (people || []).length - currentCount;

  return (
    <>
      <ConnecteamCard onSynced={load} />

      {error && (
        <div className="card">
          <p className="error-text">Failed to load staff: {error}</p>
        </div>
      )}

      {!error && people === null && <p style={{ color: "var(--muted)" }}>Loading...</p>}

      {!error && people !== null && people.length === 0 && (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>No staff synced yet — click Sync now above.</p>
        </div>
      )}

      {!error && people !== null && people.length > 0 && (
        <div className="card">
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.9rem" }}>
            <input
              placeholder="Search name, role, team, email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ flex: "1 1 220px" }}
            />
            <select value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">All departments</option>
              {options.departments.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">All teams</option>
              {options.teams.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">All branches</option>
              {options.branches.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              <input type="checkbox" checked={showFormer} onChange={(e) => setShowFormer(e.target.checked)} />
              Show former staff ({formerCount})
            </label>
          </div>

          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0 0 0.6rem" }}>
            Showing {visible.length} of {showFormer ? people.length : currentCount}
          </p>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Job title</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Team</th>
                  <th>Branch</th>
                  <th>Manager</th>
                  <th>Email</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.id} style={p.details.former ? { opacity: 0.55 } : undefined}>
                    <td>
                      {p.name}
                      {p.details.former && (
                        <span style={{ marginLeft: "0.4rem", fontSize: "0.7rem", border: "1px solid var(--border)", borderRadius: "4px", padding: "0.05rem 0.35rem" }}>
                          Former
                        </span>
                      )}
                    </td>
                    <td>{p.details.jobTitle || "—"}</td>
                    <td>{p.details.role || "—"}</td>
                    <td>{p.details.department || "—"}</td>
                    <td>{p.details.team || "—"}</td>
                    <td>{p.details.branch || "—"}</td>
                    <td>{p.details.manager || "—"}</td>
                    <td>{p.details.email || "—"}</td>
                    <td>{p.details.phone || "—"}</td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ color: "var(--muted)" }}>
                      Nobody matches those filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
