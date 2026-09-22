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
  domain_expires_at: string | null;
  domain_expiry_checked_at: string | null;
  domain_expiry_unavailable: boolean;
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

export type SeoCheck = {
  website_id: string;
  title: string | null;
  meta_description: string | null;
  canonical_url: string | null;
  has_noindex: boolean;
  robots_txt_status: "found" | "missing" | "error";
  robots_disallows_all: boolean;
  sitemap_status: "found" | "missing" | "error";
  sitemap_in_robots: boolean;
  checked_at: string;
};

export type GoogleService = "analytics" | "search_console";

export type GoogleConnection = {
  service: GoogleService;
  external_account_email: string | null;
  property_id: string | null;
  site_url: string | null;
  connected_at: string;
  last_synced_at: string | null;
};

export type IncidentSeverity = "critical" | "offline";

export type Incident = {
  id: string;
  website_id: string;
  severity: IncidentSeverity;
  started_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  detection_count: number;
  created_at: string;
};

/** Everything the command centre / grid needs for one row, assembled client-side. */
export type WebsiteWithHealth = Website & {
  latestCheck: HealthCheck | null;
  uptimePercent7d: number | null;
  checksCount7d: number;
  status: WebsiteStatus;
  brokenLinkCount: number;
  openIncident: Incident | null;
};
