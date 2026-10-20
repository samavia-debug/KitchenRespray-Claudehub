"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CrmProvider, useCrm } from "./crm-context";

const LINKS = [
  { href: "/dashboard/crm/companies", label: "Companies" },
  { href: "/dashboard/crm/follow-ups", label: "Follow-ups" },
  { href: "/dashboard/crm/contacts", label: "Contacts" },
  { href: "/dashboard/crm/pipeline", label: "Sales Pipeline" },
  { href: "/dashboard/crm/settings", label: "Settings", adminOnly: true },
];

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { meta, error, setupNeeded } = useCrm();

  return (
    <>
      <div className="page-header">
        <h1>🤝 Trade Sales CRM</h1>
        <p>Commercial prospects: hotels, facility managers, estate agents, builders and trades. Find them, contact them, follow up, and see what turns into work.</p>
      </div>

      {setupNeeded && <p className="error-text">The CRM tables are not set up yet. Run the trade_crm migration in Supabase, then reload this page.</p>}
      {error && !setupNeeded && <p className="error-text">{error}</p>}

      {meta ? (
        <>
          <nav className="tabs" aria-label="Trade Sales CRM">
            {LINKS.filter((l) => !l.adminOnly || meta.role === "Admin").map((l) => (
              <Link key={l.href} href={l.href} className={pathname.startsWith(l.href) ? "active" : ""}>
                {l.label}
              </Link>
            ))}
          </nav>
          {children}
        </>
      ) : (
        !error && <p style={{ color: "var(--muted)" }}>Loading...</p>
      )}
    </>
  );
}

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <CrmProvider>
      <Shell>{children}</Shell>
    </CrmProvider>
  );
}
