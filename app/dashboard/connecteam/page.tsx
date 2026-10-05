"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import StaffTab from "../knowledge-base/staff-tab";

export default function ConnecteamPage() {
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

      // Staff records sit in Eleven's Admin-only store, so this page is too.
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
        <h1>👥 Connecteam</h1>
        <p>
          Your Connecteam staff list, synced into Eleven so you can search it here or ask Eleven about it. Pay, birthday and
          home address are never copied across.
        </p>
      </div>
      {authorized ? <StaffTab /> : <p style={{ color: "var(--muted)" }}>Loading...</p>}
    </>
  );
}
