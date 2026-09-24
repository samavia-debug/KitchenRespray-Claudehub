"use client";

/**
 * Same dependency-free inline SVG approach as ResponseTimeChart, but for
 * a generic { date, value } series instead of HealthCheck rows — shared
 * by the GA4 and Search Console cards, which each plot a different metric.
 */
export default function MetricTrendChart({
  points,
  height = 100,
  color = "#b5502e",
  valueSuffix = "",
}: {
  points: { date: string; value: number }[];
  height?: number;
  color?: string;
  valueSuffix?: string;
}) {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));

  if (sorted.length === 0) {
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
  const values = sorted.map((p) => p.value);
  const max = Math.max(...values, 1);
  const padding = 10;
  const plotW = width - padding * 2;
  const plotH = height - padding * 2;
  const stepX = sorted.length > 1 ? plotW / (sorted.length - 1) : 0;

  const coords = sorted.map((p, i) => ({
    x: padding + i * stepX,
    y: padding + plotH - (p.value / max) * plotH,
    point: p,
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(height - padding).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(height - padding).toFixed(1)} Z`;

  const gridFractions = [0.25, 0.5, 0.75];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height, display: "block" }} preserveAspectRatio="none">
      {gridFractions.map((f, i) => {
        const y = padding + plotH * (1 - f);
        return <line key={i} x1={padding} x2={width - padding} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />;
      })}
      <path d={areaPath} fill={color} opacity={0.12} />
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
      {coords.map((c, i) => (
        <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 4 : 3} fill={i === coords.length - 1 ? color : "transparent"}>
          <title>{`${c.point.date} — ${c.point.value}${valueSuffix}`}</title>
        </circle>
      ))}
    </svg>
  );
}
