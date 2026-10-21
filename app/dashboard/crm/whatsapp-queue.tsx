"use client";

import { useEffect, useMemo, useState } from "react";
import type { Queue } from "@/lib/crm/whatsapp-service";
import { chatLink, fillTemplate } from "@/lib/crm/whatsapp";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { fmtDate, personName } from "./fmt";
import QuickDate from "./quick-date";

const KINDS = [
  { value: "WhatsApp message", label: "First message", template: "first_message" },
  { value: "WhatsApp follow-up", label: "Follow-up", template: "follow_up" },
] as const;

/**
 * Sends WhatsApp messages one company at a time. Each message is the fixed wording with the company's blanks filled in;
 * WhatsApp opens with it typed, the person presses Send there, then "Sent, next" records it against the company. Nothing
 * is sent from here, and nothing is recorded until the person says it was sent.
 */
export default function WhatsappQueue({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const { meta } = useCrm();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<(typeof KINDS)[number]>(KINDS[0]);
  const [bookFollowUp, setBookFollowUp] = useState(false);
  const [followUp, setFollowUp] = useState("");
  const [position, setPosition] = useState(0);
  const [sent, setSent] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api("/api/crm/whatsapp/queue", { method: "POST", body: { ids } }).then((res) => {
      if (!res.ok) return setLoadError(res.body.error || "Could not prepare the queue");
      setQueue(res.body as Queue);
    });
  }, [ids]);

  const sender = useMemo(() => personName(meta?.assignees.find((a) => a.id === meta.me)?.email).split(" ")[0], [meta]);
  const todo = useMemo(() => (queue ? queue.entries.filter((e) => !e.sent_today) : []), [queue]);
  const alreadyToday = queue ? queue.entries.length - todo.length : 0;
  const current = todo[position] ?? null;
  const template = queue ? queue.templates[kind.template] : "";

  const filled = useMemo(
    () => (current ? fillTemplate(template, { name: current.contact_first_name, company: current.name, county: current.county, sender, offer: current.offer, code: current.code }) : null),
    [current, template, sender]
  );
  const problems = [...(current && !current.number ? [current.reason ?? "There is no number to use"] : []), ...(filled?.problems ?? [])];
  const blocked = problems.length > 0;

  // A new company (or a change of message) starts from the fixed wording again.
  useEffect(() => {
    setText(filled?.text ?? "");
    setOpened(false);
    setError(null);
  }, [current?.id, kind, filled?.text]);

  function next(wasSent: boolean) {
    if (wasSent) setSent((n) => n + 1);
    else setSkipped((n) => n + 1);
    setPosition((p) => p + 1);
  }

  async function markSent() {
    if (!current) return;
    if (bookFollowUp && !followUp) return setError("Choose the follow-up date, or untick \"Book a follow-up for each\". It has not been marked as sent.");
    setBusy(true);
    setError(null);
    const res = await api("/api/crm/activities/bulk", {
      method: "POST",
      body: {
        ids: [current.id],
        type: kind.value,
        occurred_at: new Date().toISOString(),
        notes: text.trim() || null,
        user_id: meta?.me ?? null,
        next_follow_up: followUp || null,
        next_action: followUp ? "Follow up on WhatsApp" : null,
        confirmed: true,
      },
    });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not record it. It has not been marked as sent.");
    next(true);
  }

  function finish() {
    if (sent > 0) onDone(`WhatsApp queue: ${sent} sent and recorded${skipped ? `, ${skipped} skipped` : ""}${alreadyToday ? `, ${alreadyToday} left out because they already had a WhatsApp today` : ""}.`);
    else onClose();
  }

  const finished = !!queue && position >= todo.length;
  const label = (type: string) => (type === "WhatsApp follow-up" ? "follow-up" : "message");

  return (
    <div className="crm-modal" role="dialog" aria-modal="true" aria-label="Send WhatsApp messages">
      <div style={{ maxWidth: 560, maxHeight: "92vh", overflowY: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Send WhatsApp</h2>

        {loadError && <p className="error-text">{loadError}</p>}
        {!queue && !loadError && <p style={{ color: "var(--muted)" }}>Getting the numbers ready...</p>}

        {queue && (
          <>
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ margin: 0 }}>
                <label>Which message</label>
                <select value={kind.value} onChange={(e) => setKind(KINDS.find((k) => k.value === e.target.value) ?? KINDS[0])} disabled={busy}>
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>
              <label style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center", fontSize: "0.85rem", paddingBottom: "0.5rem" }}>
                <input
                  type="checkbox"
                  checked={bookFollowUp}
                  onChange={(e) => {
                    setBookFollowUp(e.target.checked);
                    if (!e.target.checked) setFollowUp("");
                  }}
                />
                Book a follow-up for each
              </label>
            </div>
            {bookFollowUp && <QuickDate label="Follow up on" value={followUp} onChange={setFollowUp} />}
            {!queue.templatesSaved && (
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.8rem", color: "var(--muted)" }}>This is the starter wording. An Admin can set the approved messages in CRM Settings.</p>
            )}

            {alreadyToday > 0 && (
              <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem" }}>
                {alreadyToday} compan{alreadyToday === 1 ? "y" : "ies"} already had a WhatsApp recorded today, so {alreadyToday === 1 ? "it is" : "they are"} left out.
              </p>
            )}
            {queue.notFound > 0 && <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem" }}>{queue.notFound} could not be found (they may have been archived).</p>}

            {finished ? (
              <div>
                <p style={{ fontWeight: 600 }}>{todo.length === 0 ? "There is nobody to message." : "That is everyone."}</p>
                <p style={{ margin: "0 0 1rem", fontSize: "0.9rem" }}>
                  {sent} sent and recorded{skipped ? `, ${skipped} skipped` : ""}.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn" onClick={finish}>
                    Close
                  </button>
                </div>
              </div>
            ) : (
              current &&
              filled && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.8rem", color: "var(--muted)", margin: "0.25rem 0" }}>
                    <span>
                      Company {position + 1} of {todo.length}
                    </span>
                    <span>
                      {sent} sent, {skipped} skipped
                    </span>
                  </div>
                  <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "0.8rem" }}>
                    <div style={{ fontWeight: 600 }}>{current.name}</div>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)" }}>
                      {[current.city, current.county].filter(Boolean).join(", ") || "No town or county"}
                      {current.shown && ` · ${current.shown}`}
                    </div>
                    {current.last_whatsapp && (
                      <div style={{ fontSize: "0.8rem", marginTop: "0.3rem", color: kind.value === "WhatsApp message" ? "var(--attention)" : "var(--muted)" }}>
                        Last WhatsApp {label(current.last_whatsapp.type)}: {fmtDate(current.last_whatsapp.at)}
                        {kind.value === "WhatsApp message" && " (this company has already had one: is this meant to be the follow-up?)"}
                      </div>
                    )}

                    {blocked ? (
                      <div style={{ marginTop: "0.6rem" }}>
                        {problems.map((p) => (
                          <p key={p} className="error-text" style={{ margin: "0 0 0.3rem" }}>
                            {p}
                          </p>
                        ))}
                        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>This one cannot be sent from the queue as it is. Skip it, then fix what is missing and select it again, or message them another way.</p>
                      </div>
                    ) : (
                      <div className="field" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
                        <label>The message (you can change it for this company)</label>
                        <textarea rows={7} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
                      </div>
                    )}
                  </div>

                  {error && <p className="error-text" style={{ marginBottom: 0 }}>{error}</p>}

                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "space-between", marginTop: "0.9rem" }}>
                    <button className="btn btn-secondary" onClick={() => next(false)} disabled={busy}>
                      Skip
                    </button>
                    {!blocked && current.number && (
                      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                        <a className="btn" href={chatLink(current.number, text.trim())} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
                          Open WhatsApp
                        </a>
                        <button className="btn btn-secondary" onClick={markSent} disabled={!opened || busy || !text.trim()} title={opened ? undefined : "Open WhatsApp and send the message first"}>
                          {busy ? "Recording..." : "Sent, next"}
                        </button>
                      </div>
                    )}
                  </div>
                  <p style={{ margin: "0.75rem 0 0", fontSize: "0.78rem", color: "var(--muted)" }}>
                    Press Send in WhatsApp, come back here, then press Sent, next. Only press it for messages you really sent: it records the message against the company and moves its last-contacted date.
                  </p>
                </div>
              )
            )}

            {!finished && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.9rem" }}>
                <button className="btn btn-secondary" onClick={finish} disabled={busy}>
                  Stop and close
                </button>
              </div>
            )}
          </>
        )}
        {(loadError || !queue) && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "0.9rem" }}>
            <button className="btn btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
