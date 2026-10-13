"use client";

import { renderLetter, type LetterContent, type LetterSettings } from "@/lib/letters/layout";

/**
 * The letter as it will print and as the Word file is laid out. The same
 * renderLetter() feeds both, so what is previewed is what is exported. The
 * `letter-sheet` class is what the print stylesheet keeps on the page.
 */
export default function LetterPreview({ settings, content }: { settings: LetterSettings; content: LetterContent }) {
  const l = renderLetter(settings, content);
  const text: React.CSSProperties = { margin: "0 0 0.9em", lineHeight: 1.5 };

  return (
    <div
      className="letter-sheet"
      style={{
        background: "#fff",
        color: "#1a1a1a",
        border: "1px solid var(--border)",
        borderRadius: 6,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        padding: "2rem 2.25rem",
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: "0.95rem",
        minHeight: 420,
        overflowWrap: "anywhere",
      }}
    >
      {l.banner && <p style={{ ...text, color: "#b3261e", fontWeight: 700, fontSize: "0.82rem" }}>{l.banner}</p>}

      {l.letterhead.length > 0 && (
        <div style={{ textAlign: "right", marginBottom: "1.6em" }}>
          {l.letterhead.map((line, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 700 : 400, fontSize: i === 0 ? "1.25rem" : "0.8rem", color: i === 0 ? "#1a1a1a" : "#555" }}>
              {line}
            </div>
          ))}
        </div>
      )}

      <p style={text}>{l.dateText}</p>

      {l.recipientLines.length > 0 && (
        <p style={text}>
          {l.recipientLines.map((line, i) => (
            <span key={i} style={{ display: "block" }}>
              {line}
            </span>
          ))}
        </p>
      )}

      {l.greeting && <p style={text}>{l.greeting}</p>}
      {l.subject && <p style={{ ...text, fontWeight: 700 }}>{l.subject}</p>}
      {l.paragraphs.length === 0 && <p style={{ ...text, color: "#999" }}>The letter text will appear here.</p>}
      {l.paragraphs.map((p, i) => (
        <p key={i} style={{ ...text, textAlign: "justify", whiteSpace: "pre-line" }}>
          {p}
        </p>
      ))}

      {l.closing && <p style={{ ...text, marginBottom: 0 }}>{l.closing}</p>}
      <div style={{ marginTop: "0.4em" }}>
        {l.signature.map((line, i) => (
          <div key={i} style={{ fontWeight: i === 2 ? 700 : 400, minHeight: line ? undefined : "1.2em", color: line.startsWith("[") ? "#b3261e" : undefined }}>
            {line || " "}
          </div>
        ))}
      </div>

      {l.footer && <p style={{ marginTop: "2em", fontSize: "0.75rem", color: "#777", whiteSpace: "pre-line" }}>{l.footer}</p>}
    </div>
  );
}
