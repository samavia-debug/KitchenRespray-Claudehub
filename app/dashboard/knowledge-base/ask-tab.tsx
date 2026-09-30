"use client";

import { useEffect, useRef, useState } from "react";
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
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [speakEnabled, setSpeakEnabled] = useState(false);

  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef("");

  // Web Speech API support varies by browser (solid in Chrome/Edge, absent
  // in Safari/Firefox for SpeechRecognition) — feature-detect rather than
  // assuming, so unsupported browsers just don't see the voice controls
  // instead of a broken button.
  const micSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const speechSupported = typeof window !== "undefined" && !!window.speechSynthesis;

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (speechSupported) window.speechSynthesis.cancel();
    };
  }, [speechSupported]);

  function speak(text: string) {
    if (!speechSupported) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (speechSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }

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
          if (speakEnabled) speak(data.answer);
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

  function toggleListening() {
    if (!micSupported) return;

    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new Ctor();
    recognition.interimResults = true;
    recognition.continuous = false;
    transcriptRef.current = "";

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      transcriptRef.current = transcript;
      setQuestion(transcript);
    };
    // Read from the ref, not the `question` state — this closure was
    // created when listening started, so `question` here would be stale.
    recognition.onend = () => {
      setListening(false);
      if (transcriptRef.current.trim()) ask(transcriptRef.current);
    };
    recognition.onerror = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  return (
    <>
      <div className="card" style={{ marginBottom: "1.25rem" }}>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            placeholder="Ask Eleven anything..."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ask(question)}
            style={{ flex: 1 }}
            disabled={asking}
          />
          {micSupported && (
            <button
              type="button"
              className="btn-secondary btn"
              onClick={toggleListening}
              disabled={asking}
              title={listening ? "Stop listening" : "Ask by voice"}
              style={listening ? { color: "#b3261e", borderColor: "#b3261e" } : undefined}
            >
              {listening ? "● Listening..." : "🎤"}
            </button>
          )}
          <button className="btn" onClick={() => ask(question)} disabled={asking || !question.trim()}>
            {asking ? "Thinking..." : "Ask"}
          </button>
        </div>

        <div style={{ marginTop: "0.6rem", display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          {speechSupported && (
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--muted)" }}>
              <input type="checkbox" checked={speakEnabled} onChange={(e) => setSpeakEnabled(e.target.checked)} />
              Speak answers aloud
            </label>
          )}
          {speaking && (
            <button className="btn-secondary btn" style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }} onClick={stopSpeaking}>
              🔇 Stop speaking
            </button>
          )}
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
