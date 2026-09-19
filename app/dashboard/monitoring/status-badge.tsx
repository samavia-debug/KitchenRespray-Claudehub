import { STATUS_COLOR, STATUS_LABEL } from "@/lib/monitoring/status";
import type { WebsiteStatus } from "@/lib/monitoring/types";

export default function StatusBadge({ status }: { status: WebsiteStatus }) {
  const color = STATUS_COLOR[status];
  return (
    <span
      className="status-badge"
      style={{ background: `${color}1a`, color }}
    >
      <span className="status-dot" style={{ background: color }} />
      {STATUS_LABEL[status]}
    </span>
  );
}
