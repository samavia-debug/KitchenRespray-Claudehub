export type WebsitePriority = "critical" | "high" | "medium" | "low";

export type Website = {
  id: string;
  name: string;
  domain: string;
  category: string | null;
  priority: WebsitePriority;
  monitoring_interval_minutes: number;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type HealthCheck = {
  id: string;
  website_id: string;
  checked_at: string;
  is_up: boolean;
  http_status: number | null;
  response_time_ms: number | null;
  ssl_valid: boolean | null;
  ssl_expires_at: string | null;
  error_message: string | null;
  likely_blocked: boolean;
};

export type WebsiteStatus = "healthy" | "attention" | "critical" | "offline" | "unknown";

export type LinkType = "internal" | "external";

export type LinkCheck = {
  id: string;
  website_id: string;
  source_url: string;
  target_url: string;
  link_type: LinkType;
  http_status: number | null;
  is_broken: boolean;
  error_message: string | null;
  first_detected_at: string;
  last_checked_at: string;
};

/** Everything the command centre / grid needs for one row, assembled client-side. */
export type WebsiteWithHealth = Website & {
  latestCheck: HealthCheck | null;
  uptimePercent7d: number | null;
  checksCount7d: number;
  status: WebsiteStatus;
  brokenLinkCount: number;
};
