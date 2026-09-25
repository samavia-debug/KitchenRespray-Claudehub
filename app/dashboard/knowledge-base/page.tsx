"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EntryType } from "./entry-types";
import OverviewTab from "./overview-tab";
import AskTab from "./ask-tab";
import AllKnowledgeTab from "./all-knowledge-tab";
import DocumentsTab from "./documents-tab";
import HealthTab from "./health-tab";

const TABS = ["Overview", "Ask the Brain", "All Knowledge", "Documents", "Knowledge Health"] as const;
type Tab = (typeof TABS)[number];

export default function KnowledgeBasePage() {
  const supabase = createClient();
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("Overview");

  // Remounts AllKnowledgeTab with fresh initial values whenever a quick-add
  // or "view source" jump happens, since its filters/form are internal state.
  const [allKnowledgeSeed, setAllKnowledgeSeed] = useState<{ key: number; type?: EntryType; query?: string }>({ key: 0 });

  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: myProfile } = await supabase.from("profiles").select("role").eq("id", user.id).single();

      if (myProfile?.role !== "Admin" && myProfile?.role !== "Manager") {
        router.replace("/dashboard");
        return;
      }

      setAuthorized(true);
      setLoading(false);
    }
    init();
  }, [supabase, router]);

  function quickAdd(type: EntryType) {
    setAllKnowledgeSeed((s) => ({ key: s.key + 1, type }));
    setTab("All Knowledge");
  }

  function viewSource(title: string) {
    setAllKnowledgeSeed((s) => ({ key: s.key + 1, query: title }));
    setTab("All Knowledge");
  }

  if (loading || !authorized) {
    return (
      <>
        <div className="page-header">
          <h1>🧠 Business Brain</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>🧠 Business Brain</h1>
        <p>
          The dashboard's shared knowledge, memory, and context layer — documents, SOPs, decisions, people, and
          brand/service knowledge Claude draws on when answering questions or analysing a site. Brand voice for
          Claude Design still lives separately at <a href="/dashboard/knowledge">Company Knowledge</a>.
        </p>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && <OverviewTab onQuickAdd={quickAdd} onGoToAsk={() => setTab("Ask the Brain")} />}
      {tab === "Ask the Brain" && <AskTab onViewSource={viewSource} />}
      {tab === "All Knowledge" && (
        <AllKnowledgeTab key={allKnowledgeSeed.key} initialType={allKnowledgeSeed.type} initialQuery={allKnowledgeSeed.query} />
      )}
      {tab === "Documents" && <DocumentsTab />}
      {tab === "Knowledge Health" && <HealthTab />}
    </>
  );
}
