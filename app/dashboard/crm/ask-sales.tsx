"use client";

import { useState } from "react";
import { api } from "./api";
import { useCrm } from "./crm-context";
import { personName } from "./fmt";
import type { Controls } from "./report-ui";

/**
 * A question box for the sales figures. The answer is written by the AI from the CRM's own records for the period and
 * filters on screen, and says when something is not in the data. It is a reading aid: check anything that matters
 * against the figures above.
 */
export default function AskSales({ controls }: { controls: Controls }) {
  const { meta } = useCrm();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ text: string; period: string; asked: string } | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);

  const me = meta?.assignees.find((a) => a.id === meta.me);
  const examples = [
    me ? `How many prospects did ${personName(me.email).split(" ")[0]} add this month?` : "How many prospects were added this month?",
    "Which prospects have not been contacted?",
    "Which follow-ups are overdue?",
    "Which categories are generating the most interest?",
    "How many quotes have been generated from direct prospecting?",
    "What is the recorded value of opportunities won this month?",
    "Which prospects should we prioritise next week?",
  ];

  async function ask(text: string) {
    const q = text.trim();
    if (q.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    const res = await api("/api/crm/ai/ask", {
      method: "POST",
      body: { question: q, range: controls.range, from: controls.from, to: controls.to, category_id: controls.category, staff_id: controls.staff },
    });
    setBusy(false);
    if (!res.ok) return setError(res.body.error || "Could not answer that");
    setAnswer({ text: res.body.answer, period: res.body.period, asked: q });
    setRemaining(res.body.remaining);
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Ask about your sales</h2>
        {remaining !== null && <span style={{ fontSize: "0.78rem", color: "var(--muted)" }}>{remaining} AI request{remaining === 1 ? "" : "s"} left today</span>}
      </div>
      <p style={{ margin: "0.3rem 0 0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>
        Answers come from the CRM's own records (the period and filters above, plus this month, last month and today's lists). If something is not in the data it will say so. Check anything important against the figures.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}
      >
        <input style={{ flex: "1 1 320px" }} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} placeholder="Type a question about prospects, follow-ups, quotes or sales" aria-label="Your question" />
        <button className="btn" type="submit" disabled={busy || question.trim().length < 3}>
          {busy ? "Looking..." : "Ask"}
        </button>
      </form>
      <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
        {examples.map((x) => (
          <button
            key={x}
            type="button"
            className="btn btn-secondary"
            style={{ padding: "0.2rem 0.55rem", fontSize: "0.75rem" }}
            disabled={busy}
            onClick={() => {
              setQuestion(x);
              ask(x);
            }}
          >
            {x}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      {answer && (
        <div style={{ marginTop: "1rem", padding: "0.9rem 1rem", background: "var(--accent-soft)", borderRadius: 10 }}>
          <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginBottom: "0.35rem" }}>
            You asked: {answer.asked} · Period on screen: {answer.period}
          </div>
          <div style={{ whiteSpace: "pre-line", fontSize: "0.92rem" }}>{answer.text}</div>
        </div>
      )}
    </div>
  );
}
