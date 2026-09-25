"use client";

import { useState } from "react";
import { ENTRY_TYPE_LABELS, type EntryType } from "./entry-types";

type Source = { id: string; title: string; entry_type: EntryType };
type Exchange = { question: string; answer?: string; sources?: Source[]; error?: string };

const SUGGESTIONS = [
  "What are today's updates?",
  "Which sites are performing best this week?",
  "What services do we offer?",
  "Who is responsible for Canva graphics?",
];

export default function AskTab({ onViewSource }: { onViewSource: (title: string) => void }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [history, setHistory] = useState<Exchange[]>([]);

  async function ask(q: string) {
    if (!q.trim() || asking) return;
    setAsking(true);
    setQuestion("");
    setHistory((h) => [...h, { question: q }]);

    try {
      const res = await fetch("/api/brain/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();

      setHistory((h) => {
        const next = [...h];
        const last = next[next.length - 1];
        if (!res.ok) {
          next[next.length - 1] = { ...last, error: data.error || "Something went wrong." };
        } else {
          next[next.length - 1] = { ...last, answer: data.answer, sources: data.sources || [] };
        }
        return next;
      });
    } catch (err: any) {
      setHistory((h) => {
        const next = [...h];
        next[next.length - 1] = { ...next[next.length - 1], error: err.message || "Network error." };
        return next;
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            placeholder="Ask the Business Brain anything..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question)}
            style={{ flex: 1 }}
            disabled={asking}
          />
          <button className="btn" onClick={() => ask(question)} disabled={asking || !question.trim()}>
            {asking ? "Thinking..." : "Ask"}
          </button>
        </div>
        {history.length === 0 && (
          <div style={{ marginTop: "0.85rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="btn-secondary btn" style={{ fontSize: "0.8rem" }} onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {history
        .slice()
        .reverse()
        .map((ex, i) => (
          <div key={i} className="card" style={{ marginBottom: "0.75rem" }}>
            <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>{ex.question}</p>
            {ex.error ? (
              <p className="error-text">{ex.error}</p>
            ) : ex.answer === undefined ? (
              <p style={{ color: "var(--muted)" }}>Thinking...</p>
            ) : (
              <>
                <p style={{ whiteSpace: "pre-wrap", fontSize: "0.95rem" }}>{ex.answer}</p>
                {ex.sources && ex.sources.length > 0 && (
                  <div style={{ marginTop: "0.75rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                    <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.35rem" }}>Sources:</p>
                    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                      {ex.sources.map((s) => (
                        <button
                          key={s.id}
                          className="btn-secondary btn"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                          onClick={() => onViewSource(s.title)}
                        >
                          {ENTRY_TYPE_LABELS[s.entry_type]}: {s.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
    </>
  );
}
