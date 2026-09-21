"use client";

import { useState } from "react";

export default function CheckAllButton({ onChecked, label = "Check all websites now" }: { onChecked: () => void; label?: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/monitoring/websites/check-all", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Bulk check failed");
      } else {
        setResult(`Checked ${data.checkedCount} of ${data.totalCount} websites.`);
        onChecked();
      }
    } catch (err: any) {
      setError(err.message);
    }

    setRunning(false);
  }

  return (
    <div>
      <button className="btn" onClick={run} disabled={running}>
        {running ? "Checking all websites... this can take a minute" : label}
      </button>
      {error && <p className="error-text">{error}</p>}
      {result && <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginTop: "0.4rem" }}>{result}</p>}
    </div>
  );
}
