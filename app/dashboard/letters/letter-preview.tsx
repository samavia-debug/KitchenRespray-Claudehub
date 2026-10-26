"use client";

import { LETTERHEAD, SHEET_PADDING } from "@/lib/letters/letterhead";
import { renderLetter, type LetterContent, type LetterSettings } from "@/lib/letters/layout";

/**
 * The letter as it will print and as the Word file is laid out, on the company letterhead. The same
 * renderLetter() feeds both, so what is previewed is what is exported. The page is drawn at A4 proportions
 * and its text is sized from the page width (cqw), so it looks the same at any size; the `letter-page` and
 * `letter-sheet` classes are what the print stylesheet sets to a real A4 sheet.
 */
export default function LetterPreview({ settings, content }: { settings: LetterSettings; content: LetterContent }) {
  const l = renderLetter(settings, content, { artwork: true });
  const text: React.CSSProperties = { margin: "0 0 0.9em", lineHeight: 1.5 };

  return (
    <div className="letter-page" style={{ containerType: "inline-size", width: "100%" }}>
      <div
        className="letter-sheet"
        style={{
          background: `#fff url(${LETTERHEAD.src}) no-repeat top left / 100% auto`,
          color: "#1a1a1a",
          border: "1px solid var(--border)",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          boxSizing: "border-box",
          padding: SHEET_PADDING,
          aspectRatio: `${LETTERHEAD.pageWidthMm} / ${LETTERHEAD.pageHeightMm}`,
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: "1.85cqw",
          overflowWrap: "anywhere",
        }}
      >
        {l.banner && <p style={{ ...text, color: "#b3261e", fontWeight: 700, fontSize: "0.85em" }}>{l.banner}</p>}

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
              {line || " "}
            </div>
          ))}
        </div>

        {l.footer && <p style={{ marginTop: "2em", fontSize: "0.85em", color: "#777", whiteSpace: "pre-line" }}>{l.footer}</p>}
      </div>
    </div>
  );
}
