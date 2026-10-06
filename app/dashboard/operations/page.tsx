"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import TodayView from "./today-view";

export default function OperationsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

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
        <p>What is happening today across the team: who is working, who is late, what needs attention. Click anyone or any job type to drill in.</p>
      </div>
      {authorized ? <TodayView /> : <p style={{ color: "var(--muted)" }}>Loading...</p>}
    </>
  );
}
