"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CompanyProfile = {
  id: number;
  company_name: string | null;
  description: string | null;
  brand_voice: string | null;
  brand_colours: string | null;
  brand_fonts: string | null;
  taglines: string | null;
  language_rules: string | null;
};

type ServiceLine = {
  id: number;
  name: string;
  description: string | null;
  target_customer: string | null;
  key_benefits: string | null;
  cta_guidance: string | null;
  subcategories: string | null;
};

export default function KnowledgePage() {
  const supabase = createClient();
  const router = useRouter();

  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [services, setServices] = useState<ServiceLine[]>([]);
  const [activeServiceId, setActiveServiceId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingService, setSavingService] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: myProfile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      if (myProfile?.role !== "Admin" && myProfile?.role !== "Manager") {
        router.replace("/dashboard");
        return;
      }

      setAuthorized(true);

      const { data: profileData } = await supabase
        .from("company_profile")
        .select("*")
        .eq("id", 1)
        .single();

      const { data: serviceData } = await supabase
        .from("service_lines")
        .select("*")
        .order("id", { ascending: true });

      if (profileData) setProfile(profileData as CompanyProfile);
      if (serviceData) {
        setServices(serviceData as ServiceLine[]);
        if (serviceData.length > 0) setActiveServiceId(serviceData[0].id);
      }
      setLoading(false);
    }

    load();
  }, []);

  async function saveProfile() {
    if (!profile) return;
    setSavingProfile(true);
    setSavedMessage(null);

    const { error } = await supabase
      .from("company_profile")
      .update({
        company_name: profile.company_name,
        description: profile.description,
        brand_voice: profile.brand_voice,
        brand_colours: profile.brand_colours,
        brand_fonts: profile.brand_fonts,
        taglines: profile.taglines,
        language_rules: profile.language_rules,
      })
      .eq("id", 1);

    setSavingProfile(false);
    setSavedMessage(error ? `Error: ${error.message}` : "Brand profile saved.");
  }

  async function saveService(service: ServiceLine) {
    setSavingService(true);
    setSavedMessage(null);

    const { error } = await supabase
      .from("service_lines")
      .update({
        description: service.description,
        target_customer: service.target_customer,
        key_benefits: service.key_benefits,
        cta_guidance: service.cta_guidance,
        subcategories: service.subcategories,
      })
      .eq("id", service.id);

    setSavingService(false);
    setSavedMessage(error ? `Error: ${error.message}` : `${service.name} saved.`);
  }

  function updateActiveService(field: keyof ServiceLine, value: string) {
    setServices((prev) =>
      prev.map((s) => (s.id === activeServiceId ? { ...s, [field]: value } : s))
    );
  }

  const activeService = services.find((s) => s.id === activeServiceId) || null;

  if (loading || !authorized) {
    return (
      <>
        <div className="page-header">
          <h1>Company Knowledge</h1>
        </div>
        <p style={{ color: "var(--muted)" }}>Loading...</p>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1>Company Knowledge</h1>
        <p>Brand voice, service lines, and content rules Claude will use.</p>
      </div>

      {savedMessage && (
        <div
          className="card"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
          }}
        >
          {savedMessage}
        </div>
      )}

      {profile && (
        <div className="card">
          <h2>Brand & Voice</h2>

          <div className="field">
            <label>Company name</label>
            <input
              value={profile.company_name || ""}
              onChange={(e) => setProfile({ ...profile, company_name: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Company description</label>
            <textarea
              rows={2}
              value={profile.description || ""}
              onChange={(e) => setProfile({ ...profile, description: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Brand voice (tone, style, personality)</label>
            <textarea
              rows={3}
              value={profile.brand_voice || ""}
              onChange={(e) => setProfile({ ...profile, brand_voice: e.target.value })}
            />
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Brand colours</label>
              <input
                value={profile.brand_colours || ""}
                onChange={(e) => setProfile({ ...profile, brand_colours: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Brand fonts</label>
              <input
                value={profile.brand_fonts || ""}
                onChange={(e) => setProfile({ ...profile, brand_fonts: e.target.value })}
              />
            </div>
          </div>

          <div className="field">
            <label>Taglines / core messages</label>
            <textarea
              rows={2}
              value={profile.taglines || ""}
              onChange={(e) => setProfile({ ...profile, taglines: e.target.value })}
            />
          </div>

          <div className="field">
            <label>Language rules (words to use / avoid)</label>
            <textarea
              rows={2}
              value={profile.language_rules || ""}
              onChange={(e) => setProfile({ ...profile, language_rules: e.target.value })}
            />
          </div>

          <button className="btn" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? "Saving..." : "Save brand profile"}
          </button>
        </div>
      )}

      <div className="card">
        <h2>Service Lines</h2>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
          {services.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveServiceId(s.id)}
              className={s.id === activeServiceId ? "btn" : "btn-secondary btn"}
              style={{ fontSize: "0.85rem", padding: "0.45rem 0.8rem" }}
            >
              {s.name}
            </button>
          ))}
        </div>

        {activeService && (
          <div>
            <div className="field">
              <label>Description</label>
              <textarea
                rows={2}
                value={activeService.description || ""}
                onChange={(e) => updateActiveService("description", e.target.value)}
              />
            </div>

            <div className="field">
              <label>Target customer</label>
              <input
                value={activeService.target_customer || ""}
                onChange={(e) => updateActiveService("target_customer", e.target.value)}
              />
            </div>

            <div className="field">
              <label>Key benefits / selling points</label>
              <textarea
                rows={2}
                value={activeService.key_benefits || ""}
                onChange={(e) => updateActiveService("key_benefits", e.target.value)}
              />
            </div>

            <div className="field">
              <label>CTA guidance</label>
              <input
                value={activeService.cta_guidance || ""}
                onChange={(e) => updateActiveService("cta_guidance", e.target.value)}
              />
            </div>

            {activeService.name === "Wrapping" && (
              <div className="field">
                <label>Subcategories</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Worktop Wrapping, Kitchen Wrapping, Door Wrapping, Bathroom Wrapping"
                  value={activeService.subcategories || ""}
                  onChange={(e) => updateActiveService("subcategories", e.target.value)}
                />
              </div>
            )}

            <button
              className="btn"
              onClick={() => saveService(activeService)}
              disabled={savingService}
            >
              {savingService ? "Saving..." : `Save ${activeService.name}`}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
