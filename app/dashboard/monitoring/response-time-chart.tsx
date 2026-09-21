"use client";

import type { HealthCheck } from "@/lib/monitoring/types";

const STATUS_COLOR: Record<string, string> = {
  healthy: "#2e7d32",
  attention: "#b98900",
  critical: "#b3261e",
  offline: "#6f6a63",
};

/**
 * Dependency-free inline SVG line chart. Deliberately hand-rolled instead
 * of pulling in a charting library — this is one line series over time,
 * which doesn't need one. Each point carries a native <title> tooltip.
 */
export default function ResponseTimeChart({
  checks,
  height = 120,
  color = "#b5502e",
}: {
  checks: HealthCheck[];
  height?: number;
  color?: string;
}) {
  const points = [...checks].reverse(); // oldest first, left to right
  const values = points.map((c) => c.response_time_ms).filter((v): v is number => v !== null);

  if (points.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--muted)",
          fontSize: "0.82rem",
        }}
      >
        No data yet
      </div>
    );
  }

  const width = 600;
  const max = values.length ? Math.max(...values, 1) : 1;
  const padding = 10;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;

  const coords = points.map((c, i) => ({
    x: padding + i * stepX,
    y: c.response_time_ms === null ? null : padding + plotH - (c.response_time_ms / max) * plotH,
    check: c,
  }));

  const drawable = coords.filter((c) => c.y !== null) as { x: number; y: number; check: HealthCheck }[];
  const linePath = drawable.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath =
    drawable.length > 0
      ? `${linePath} L ${drawable[drawable.length - 1].x.toFixed(1)} ${(height - padding).toFixed(1)} L ${drawable[0].x.toFixed(1)} ${(height - padding).toFixed(1)} Z`
      : "";

  const gridFractions = [0.25, 0.5, 0.75];
  const lastDrawn = drawable[drawable.length - 1];
  const lastColor = lastDrawn ? STATUS_COLOR[computeSimpleStatus(lastDrawn.check)] || color : color;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height, display: "block" }} preserveAspectRatio="none">
        {gridFractions.map((f, i) => {
          const y = padding + plotH * (1 - f);
          return <line key={i} x1={padding} x2={width - padding} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />;
        })}
        {areaPath && <path d={areaPath} fill={color} opacity={0.12} />}
        {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth={2} />}
        {coords.map((c, i) =>
          c.y === null ? (
            <circle key={i} cx={c.x} cy={height - padding} r={3} fill="#b3261e">
              <title>{`${new Date(c.check.checked_at).toLocaleString()} — no response`}</title>
            </circle>
          ) : (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={i === coords.length - 1 ? 4 : 3}
              fill={i === coords.length - 1 ? lastColor : "transparent"}
            >
              <title>{`${new Date(c.check.checked_at).toLocaleString()} — ${c.check.response_time_ms}ms`}</title>
            </circle>
          )
        )}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
        <span>Min {values.length ? Math.min(...values) : "—"}ms</span>
        <span>Max {values.length ? Math.max(...values) : "—"}ms</span>
        <span>Latest {points[points.length - 1]?.response_time_ms ?? "—"}ms</span>
      </div>
    </div>
  );
}

function computeSimpleStatus(c: HealthCheck): string {
  if (!c.is_up) return "offline";
  if (c.ssl_valid === false) return "critical";
  if (c.response_time_ms !== null && c.response_time_ms > 5000) return "critical";
  if (c.response_time_ms !== null && c.response_time_ms > 2000) return "attention";
  if (c.http_status !== null && c.http_status >= 400) return "attention";
  return "healthy";
}
