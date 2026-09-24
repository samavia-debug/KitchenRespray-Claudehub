"use client";

import { useEffect, useState } from "react";

type TopQuery = { query: string; clicks: number; impressions: number; ctr: number; avgPosition: number };
type Sitemap = {
  path: string;
  isSitemapsIndex: boolean;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  warnings: number;
  errors: number;
  submitted: number;
  indexed: number;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

export default function SearchConsoleInsights({ websiteId }: { websiteId: string }) {
  const [state, setState] = useState<
    | "loading"
    | { connected: false }
    | { connected: true; topQueries: TopQuery[]; sitemaps: Sitemap[] }
    | { error: string }
  >("loading");

  useEffect(() => {
    fetch(`/api/google/insights/${websiteId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) setState({ error: data.error });
        else setState(data);
      })
      .catch((err) => setState({ error: err.message }));
  }, [websiteId]);

  if (state === "loading") {
    return (
      <div className="card">
        <h2>Search Console insights</h2>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </div>
    );
  }

  if ("error" in state) {
    return (
      <div className="card">
        <h2>Search Console insights</h2>
        <p className="error-text">{state.error}</p>
      </div>
    );
  }

  if (!state.connected) {
    return (
      <div className="card">
        <h2>Search Console insights</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          Connect Search Console (see the Search Console tab) to see real search queries and sitemap
          indexing status here.
        </p>
      </div>
    );
  }

  const sitemapsWithIssues = state.sitemaps.filter((s) => s.errors > 0 || (s.submitted > 0 && s.indexed === 0));

  return (
    <div className="card">
      <h2>Search Console insights</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "1rem" }}>
        Live from Google Search Console — real search queries and indexing status, not a synced snapshot.
      </p>

      <h3 style={{ fontSize: "0.95rem", margin: "0 0 0.5rem" }}>Top search queries (last 30 days)</h3>
      {state.topQueries.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Query</th>
                <th>Clicks</th>
                <th>Impressions</th>
                <th>CTR</th>
                <th>Avg position</th>
              </tr>
            </thead>
            <tbody>
              {state.topQueries.map((q) => (
                <tr key={q.query} style={{ cursor: "default" }}>
                  <td>{q.query}</td>
                  <td>{q.clicks}</td>
                  <td>{q.impressions}</td>
                  <td>{(q.ctr * 100).toFixed(1)}%</td>
                  <td>{q.avgPosition.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No search queries in the last 30 days.</p>
      )}

      <h3 style={{ fontSize: "0.95rem", margin: "1.5rem 0 0.5rem" }}>Sitemap indexing status</h3>
      {sitemapsWithIssues.length > 0 && (
        <p style={{ fontSize: "0.85rem", color: "#b3261e", fontWeight: 600, marginBottom: "0.5rem" }}>
          {sitemapsWithIssues.length} sitemap{sitemapsWithIssues.length === 1 ? "" : "s"} with errors or zero pages indexed —
          worth investigating.
        </p>
      )}
      {state.sitemaps.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sitemap</th>
                <th>Submitted</th>
                <th>Indexed</th>
                <th>Errors</th>
                <th>Last downloaded</th>
              </tr>
            </thead>
            <tbody>
              {state.sitemaps.map((s) => (
                <tr key={s.path} style={{ cursor: "default" }}>
                  <td style={{ maxWidth: "300px", overflow: "hidden", textOverflow: "ellipsis" }}>{s.path}</td>
                  <td>{s.submitted}</td>
                  <td style={{ color: s.submitted > 0 && s.indexed === 0 ? "#b98900" : undefined }}>{s.indexed}</td>
                  <td style={{ color: s.errors > 0 ? "#b3261e" : undefined, fontWeight: s.errors > 0 ? 600 : undefined }}>
                    {s.errors}
                  </td>
                  <td>{formatDate(s.lastDownloaded)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No sitemaps submitted to Search Console.</p>
      )}
    </div>
  );
}
