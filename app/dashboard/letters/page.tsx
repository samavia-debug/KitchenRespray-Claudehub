"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Writer from "./writer";
import SavedLetters from "./saved-letters";
import SettingsForm from "./settings-form";
import Templates from "./templates";
import Signatures from "./signatures";

const SECTIONS = ["Write a letter", "Saved letters", "Templates", "Signatures", "Letterhead"] as const;
// Managers and Staff write customer letters and quotes; the signers and the letterhead are set up by Admins.
const STAFF_SECTIONS: (typeof SECTIONS)[number][] = ["Write a letter", "Saved letters", "Templates"];

export default function LettersPage() {
  const supabase = createClient();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Write a letter");
  const [openId, setOpenId] = useState<string | null>(null);
  const [writerKey, setWriterKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsKey, setSettingsKey] = useState(0);
  const [templatesKey, setTemplatesKey] = useState(0);
  const [signersKey, setSignersKey] = useState(0);

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

      // Letters about staff are confidential, so only Admins write them. Customer letters and quotes are open to Managers and Staff too, as in the CRM; Viewers have no access.
      if (myProfile?.role !== "Admin" && myProfile?.role !== "Manager" && myProfile?.role !== "Staff") {
        router.replace("/dashboard");
        return;
      }

      setIsAdmin(myProfile?.role === "Admin");
      setAuthorized(true);
    }
    init();
  }, [supabase, router]);

  function open(id: string) {
    // A fresh writer for each letter opened, so nothing from the previous one carries over.
    setOpenId(id);
    setWriterKey((k) => k + 1);
    setSection("Write a letter");
  }

  return (
    <>
      <div className="page-header no-print">
        <h1>✉️ Letters &amp; Quotes</h1>
        <p>
          Write a letter to a customer, a quote with its lines, VAT and total, or (for Admins) a letter about a staff member from the details already in the dashboard. It is written from your templates or the ready-made paragraphs, you check and edit it, and nothing is sent or issued from here.
        </p>
      </div>

      {authorized ? (
        <>
          <div className="tabs no-print">
            {SECTIONS.filter((s) => isAdmin || STAFF_SECTIONS.includes(s)).map((s) => (
              <button key={s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* Kept mounted so a letter being written is not lost when switching tabs. */}
          <div style={{ display: section === "Write a letter" ? "block" : "none" }}>
            <Writer key={writerKey} isAdmin={isAdmin} openId={openId} settingsKey={settingsKey} templatesKey={templatesKey} signersKey={signersKey} onSaved={() => setRefreshKey((k) => k + 1)} onTemplatesChanged={() => setTemplatesKey((k) => k + 1)} />
          </div>
          {section === "Saved letters" && <SavedLetters onOpen={open} refreshKey={refreshKey} />}
          {section === "Templates" && <Templates isAdmin={isAdmin} refreshKey={templatesKey} onChanged={() => setTemplatesKey((k) => k + 1)} />}
          {isAdmin && section === "Signatures" && <Signatures refreshKey={signersKey} onChanged={() => setSignersKey((k) => k + 1)} />}
          {isAdmin && section === "Letterhead" && <SettingsForm onSaved={() => setSettingsKey((k) => k + 1)} />}
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      )}
    </>
  );
}
