"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import StaffTab from "../knowledge-base/staff-tab";
import VehiclesTab from "../knowledge-base/vehicles-tab";

const SECTIONS = ["Staff", "Vehicles"] as const;

export default function ConnecteamPage() {
  const supabase = createClient();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Staff");

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

      // Connecteam data sits in Eleven's Admin-only store, so this page is too.
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
          Your Connecteam staff list and weekly vehicle inspections, synced into Eleven so you can search them here or ask Eleven
          about them. Pay, birthday and home address are never copied across.
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
          {section === "Staff" && <StaffTab />}
          {section === "Vehicles" && <VehiclesTab />}
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      )}
    </>
  );
}
