"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import FleetView from "./fleet-view";

export default function FleetPage() {
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

      // The van list holds finance figures (what is owed to lenders), so it is Admin only.
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
        <h1>🚐 Fleet</h1>
        <p>
          Every van with its value, what is still owed on it, its driver, and when its tax, DOE and insurance are due. Dates that are overdue or coming up are marked, and a warning goes out at 30, 14 and 7 days and when one runs out.
        </p>
      </div>
      {authorized ? <FleetView /> : <p style={{ color: "var(--muted)" }}>Loading...</p>}
    </>
  );
}
