"use client";

import { addDays, dublinToday } from "@/lib/crm/followups";

const SHORTCUTS: { label: string; days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
  { label: "In 2 weeks", days: 14 },
  { label: "In a month", days: 30 },
];

/** A date box with one-click shortcuts, so setting a follow-up takes a second. Past dates cannot be picked. */
export default function QuickDate({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const today = dublinToday();
  return (
    <div className="field">
      <label>{label}</label>
      <input type="date" value={value} min={today} onChange={(e) => onChange(e.target.value)} />
      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap", marginTop: "0.35rem" }}>
        {SHORTCUTS.map((s) => (
          <button key={s.label} type="button" className="btn btn-secondary" style={{ padding: "0.15rem 0.5rem", fontSize: "0.72rem" }} onClick={() => onChange(addDays(today, s.days))}>
            {s.label}
          </button>
        ))}
        {value && (
          <button type="button" className="btn btn-secondary" style={{ padding: "0.15rem 0.5rem", fontSize: "0.72rem" }} onClick={() => onChange("")}>
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
