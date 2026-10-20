"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "../../api";
import CompanyForm, { EMPTY_COMPANY } from "../../company-form";

export default function NewCompanyPage() {
  const router = useRouter();

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h2 style={{ margin: 0 }}>Add a company</h2>
        <Link href="/dashboard/crm/companies" style={{ fontSize: "0.85rem" }}>
          Back to companies
        </Link>
      </div>
      <p style={{ margin: "0 0 1rem", color: "var(--muted)", fontSize: "0.9rem" }}>
        Only the name is required. If it looks like a company already in the CRM you will be shown it before anything is saved.
      </p>
      <CompanyForm
        initial={EMPTY_COMPANY}
        submitLabel="Save company"
        onSubmit={(values, confirmDuplicate) => api("/api/crm/companies", { method: "POST", body: { ...values, confirmDuplicate } })}
        onDone={(body) => router.push(`/dashboard/crm/companies/${body.id}`)}
        onCancel={() => router.push("/dashboard/crm/companies")}
      />
    </div>
  );
}
