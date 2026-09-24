"use client";

/** "↑ 12%" / "↓ 5%" / "→ 0%" next to a stat — shared so every page's badge behaves and looks identical. Renders nothing when there's no prior-period baseline (percentChange returned null). */
export default function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return null;
  const rounded = Math.round(value);
  const color = rounded > 0 ? "#2e7d32" : rounded < 0 ? "#b3261e" : "var(--muted)";
  const arrow = rounded > 0 ? "↑" : rounded < 0 ? "↓" : "→";
  return (
    <span style={{ fontSize: "0.85rem", fontWeight: 600, color, marginLeft: "0.5rem" }}>
      {arrow} {Math.abs(rounded)}%
    </span>
  );
}
