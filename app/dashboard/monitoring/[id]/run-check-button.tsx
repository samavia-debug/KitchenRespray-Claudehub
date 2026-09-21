"use client";

import { useState } from "react";

export default function RunCheckButton({
  websiteId,
  onChecked,
  action = "check",
  label = "Run check now",
  runningLabel = "Checking...",
}: {
  websiteId: string;
  onChecked: () => void;
  action?: "check" | "check-links";
  label?: string;
  runningLabel?: string;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);

    try {
      const res = await fetch(`/api/monitoring/websites/${websiteId}/${action}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Check failed");
      } else {
        onChecked();
      }
    } catch (err: any) {
      setError(err.message);
    }

    setRunning(false);
  }

  return (
    <div>
      <button className="btn-secondary btn" onClick={run} disabled={running}>
        {running ? runningLabel : label}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
