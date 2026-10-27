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

export default function LettersPage() {
  const supabase = createClient();
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
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

      // Employment letters are confidential staff correspondence: Admin only, like the rest of the staff data.
      if (myProfile?.role !== "Admin") {
        router.replace("/dashboard");
        return;
      }

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
        <h1>✉️ Letter Writer</h1>
        <p>
          Write a letter for a technician from the details already in the dashboard: choose the person and the kind of letter, and it fills in their name, address and contact details and writes the letter from your templates or the ready-made paragraphs. You check and edit it, and nothing is sent or issued from here.
        </p>
      </div>

      {authorized ? (
        <>
          <div className="tabs no-print">
            {SECTIONS.map((s) => (
              <button key={s} className={section === s ? "active" : ""} onClick={() => setSection(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* Kept mounted so a letter being written is not lost when switching tabs. */}
          <div style={{ display: section === "Write a letter" ? "block" : "none" }}>
            <Writer key={writerKey} openId={openId} settingsKey={settingsKey} templatesKey={templatesKey} signersKey={signersKey} onSaved={() => setRefreshKey((k) => k + 1)} onTemplatesChanged={() => setTemplatesKey((k) => k + 1)} />
          </div>
          {section === "Saved letters" && <SavedLetters onOpen={open} refreshKey={refreshKey} />}
          {section === "Templates" && <Templates refreshKey={templatesKey} onChanged={() => setTemplatesKey((k) => k + 1)} />}
          {section === "Signatures" && <Signatures refreshKey={signersKey} onChanged={() => setSignersKey((k) => k + 1)} />}
          {section === "Letterhead" && <SettingsForm onSaved={() => setSettingsKey((k) => k + 1)} />}
        </>
      ) : (
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      )}
    </>
  );
}
