"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const comingSoon = [
  "Social Media",
  "Connecteam",
];

type SyncFreshness = "fresh" | "stale" | "very-stale";

const FRESHNESS_COLOR: Record<SyncFreshness, string> = {
  fresh: "#2e7d32",
  stale: "#b98900",
  "very-stale": "#b3261e",
};

function formatHoursAgo(hours: number): string {
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default function SidebarNav() {
  const pathname = usePathname();
  const supabase = createClient();
  const [role, setRole] = useState<string | null>(null);
  const [syncFreshness, setSyncFreshness] = useState<SyncFreshness | null>(null);
  const [syncTooltip, setSyncTooltip] = useState<string>("Checking sync status...");

  useEffect(() => {
    async function checkRole() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (profile?.role) {
        setRole(profile.role);
      }
    }

    checkRole();
  }, []);

  useEffect(() => {
    // Analytics and Leads are both driven by the same Google Analytics
    // sync — a single "oldest connection" check covers both. This exists
    // because the automatic sync silently went stale for ~3 days once
    // (an external scheduler issue, not caught until someone happened to
    // ask) — a glance at the sidebar should catch that now instead.
    async function checkSyncFreshness() {
      // google_connections has no RLS policy for authenticated users at
      // all (service-role only — it holds raw OAuth tokens), so this
      // can't be a direct Supabase query from the browser like the rest
      // of this component; it goes through a small API route instead.
      let oldest: string | null = null;
      try {
        const res = await fetch("/api/google/sync-status");
        const data = await res.json();
        oldest = data.oldestSyncAt ?? null;
      } catch {
        // Network failure — fall through to the "very-stale" branch below
        // rather than silently showing nothing.
      }

      if (!oldest) {
        setSyncFreshness("very-stale");
        setSyncTooltip("No Google connections have ever synced");
        return;
      }

      const hours = (Date.now() - new Date(oldest).getTime()) / 3_600_000;
      const level: SyncFreshness = hours > 48 ? "very-stale" : hours > 24 ? "stale" : "fresh";
      setSyncFreshness(level);
      setSyncTooltip(
        level === "fresh"
          ? `All sites synced within the last 24h (oldest: ${formatHoursAgo(hours)})`
          : `Some sites haven't synced in a while — oldest: ${formatHoursAgo(hours)}`
      );
    }

    checkSyncFreshness();
  }, []);

  const isAdmin = role === "Admin";
  const isManagerOrAbove = role === "Admin" || role === "Manager";

  const liveLinks = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/monitoring", label: "Monitoring" },
    { href: "/dashboard/analytics", label: "Analytics" },
    { href: "/dashboard/leads", label: "Leads" },
    { href: "/dashboard/claude-analysis", label: "Claude Analysis" },
    { href: "/dashboard/incidents", label: "Incidents" },
    { href: "/dashboard/security", label: "Security" },
    { href: "/dashboard/claude-design", label: "Claude Design" },
    ...(isAdmin ? [{ href: "/dashboard/knowledge-base", label: "🧠 Eleven" }] : []),
    ...(isManagerOrAbove ? [{ href: "/dashboard/knowledge", label: "Company Knowledge" }] : []),
    ...(isAdmin ? [{ href: "/dashboard/settings", label: "Settings" }] : []),
  ];

  const syncBadgeHrefs = new Set(["/dashboard/analytics", "/dashboard/leads"]);

  return (
    <nav>
      {liveLinks.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={
            link.href === "/dashboard"
              ? pathname === link.href
                ? "active"
                : ""
              : pathname.startsWith(link.href)
              ? "active"
              : ""
          }
        >
          {link.label}
          {syncBadgeHrefs.has(link.href) && syncFreshness && (
            <span
              title={syncTooltip}
              style={{
                display: "inline-block",
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: FRESHNESS_COLOR[syncFreshness],
                marginLeft: "0.45rem",
                verticalAlign: "middle",
              }}
            />
          )}
        </Link>
      ))}
      <div style={{ height: "1rem" }} />
      {comingSoon.map((label) => (
        <span key={label} className="coming-soon">
          {label} <span className="tag">Soon</span>
        </span>
      ))}
    </nav>
  );
}
