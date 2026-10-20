import type { StageKind } from "@/lib/crm/types";
import { PRIORITY_COLOR, STAGE_COLOR } from "./fmt";

export function StageBadge({ name, kind }: { name: string | null; kind: string | null }) {
  if (!name) return <span style={{ color: "var(--muted)" }}>—</span>;
  const c = STAGE_COLOR[(kind as StageKind) ?? "open"] ?? STAGE_COLOR.open;
  return (
    <span className="status-badge" style={{ background: c.bg, color: c.fg }}>
      {name}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: PRIORITY_COLOR[priority] ?? "var(--muted)" }} aria-hidden />
      {priority}
    </span>
  );
}
