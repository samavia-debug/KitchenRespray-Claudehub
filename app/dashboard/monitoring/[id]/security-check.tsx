"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import RunCheckButton from "./run-check-button";

type SecurityCheck = {
  final_url: string | null;
  domain_mismatch: boolean;
  flagged_keywords: string[];
  risk_level: "none" | "suspicious" | "critical";
  error_message: string | null;
  checked_at: string;
};

const RISK_LABEL: Record<SecurityCheck["risk_level"], string> = {
  none: "No risk detected",
  suspicious: "Suspicious content flagged",
  critical: "Likely hijacked — different domain served",
};

const RISK_COLOR: Record<SecurityCheck["risk_level"], string> = {
  none: "#2e7d32",
  suspicious: "#b98900",
  critical: "#b3261e",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

export default function SecurityCheckTab({ websiteId, canManage }: { websiteId: string; canManage: boolean }) {
  const supabase = createClient();
  const [check, setCheck] = useState<SecurityCheck | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("website_security_checks")
      .select("final_url, domain_mismatch, flagged_keywords, risk_level, error_message, checked_at")
      .eq("website_id", websiteId)
      .maybeSingle();
    setCheck(data);
    setLoading(false);
  }, [supabase, websiteId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card">
      <h2>Security scan</h2>
      <p style={{ fontSize: "0.9rem", color: "var(--muted)" }}>
        Checks whether the homepage redirects to an unrelated domain and whether its content matches known
        spam/gambling keywords — the pattern of a hijacked site, not an expired domain. Runs automatically
        every 6 hours as part of the monitoring cron.
      </p>

      {canManage && (
        <div style={{ margin: "0.75rem 0" }}>
          <RunCheckButton websiteId={websiteId} action="check-security" label="Check now" runningLabel="Scanning..." onChecked={load} />
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      ) : !check ? (
        <p style={{ color: "var(--muted)" }}>No security scan recorded yet.</p>
      ) : (
        <div style={{ marginTop: "0.75rem" }}>
          <p style={{ fontSize: "1rem", fontWeight: 700, color: RISK_COLOR[check.risk_level] }}>{RISK_LABEL[check.risk_level]}</p>

          {check.error_message && <p className="error-text">Last check failed: {check.error_message}</p>}

          {check.domain_mismatch && (
            <p style={{ fontSize: "0.9rem" }}>
              <strong>Final URL:</strong> {check.final_url}
            </p>
          )}

          {check.flagged_keywords.length > 0 && (
            <p style={{ fontSize: "0.9rem" }}>
              <strong>Flagged terms found:</strong> {check.flagged_keywords.join(", ")}
            </p>
          )}

          <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.5rem" }}>Last checked: {formatDate(check.checked_at)}</p>
        </div>
      )}
    </div>
  );
}
