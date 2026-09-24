"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const comingSoon = [
  "Social Media",
  "Leads",
  "Connecteam",
  "Knowledge Base",
];

export default function SidebarNav() {
  const pathname = usePathname();
  const supabase = createClient();
  const [role, setRole] = useState<string | null>(null);

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

  const isAdmin = role === "Admin";
  const isManagerOrAbove = role === "Admin" || role === "Manager";

  const liveLinks = [
    { href: "/dashboard", label: "Overview" },
    { href: "/dashboard/monitoring", label: "Monitoring" },
    { href: "/dashboard/analytics", label: "Analytics" },
    { href: "/dashboard/claude-analysis", label: "Claude Analysis" },
    { href: "/dashboard/incidents", label: "Incidents" },
    { href: "/dashboard/claude-design", label: "Claude Design" },
    ...(isManagerOrAbove
      ? [{ href: "/dashboard/knowledge", label: "Company Knowledge" }]
      : []),
    ...(isAdmin ? [{ href: "/dashboard/settings", label: "Settings" }] : []),
  ];

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
