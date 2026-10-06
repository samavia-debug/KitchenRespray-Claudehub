"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TodayView from "./today-view";
import ScorecardView from "./scorecard-view";

const SECTIONS = ["Today", "Team scorecard"] as const;

export default function OperationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Today");

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

      // Staff clock-ins and rotas are Admin-only, like the rest of the Connecteam data.
      if (myProfile?.role !== "Admin") {
        router.replace("/dashboard");
        return;
      }

      setAuthorized(true);
    }
    init();
  }, [supabase, router]);

  return (
    <>
      <div className="page-header">
        <h1>📊 Operations</h1>
        <p>
          What is happening today across the team, and how each branch and team is doing week by week: who is working, who is late, whether
          vehicle checks and clock-outs are being done.
        </p>
      </div>

      {authorized ? (
        <>
          <div className="tabs">
            {SECTIONS.map((s) => (
              <button key={s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>
                {s}
              </button>
            ))}
          </div>
          {section === "Today" && <TodayView />}
          {section === "Team scorecard" && <ScorecardView />}
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      )}
    </>
  );
}
