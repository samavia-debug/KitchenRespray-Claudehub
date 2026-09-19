import Link from "next/link";

export default function OverviewPage() {
  return (
    <>
      <div className="page-header">
        <h1>Overview</h1>
        <p>Welcome to the KitchenRespray Claude Hub.</p>
      </div>

      <div className="grid-2">
        <Link href="/dashboard/claude-design" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <h2>Claude Design</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Submit a design brief and generate on-brand Canva designs.
          </p>
        </Link>
        <Link href="/dashboard/knowledge" className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <h2>Company Knowledge</h2>
          <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
            Manage brand voice, service lines, and content rules.
          </p>
        </Link>
      </div>
    </>
  );
}
