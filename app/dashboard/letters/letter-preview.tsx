"use client";

import { LETTERHEAD, SHEET_PADDING } from "@/lib/letters/letterhead";
import { renderLetter, type LetterContent, type LetterSettings } from "@/lib/letters/layout";

function Runs({ runs }: { runs: { text: string; bold?: boolean; italic?: boolean }[] }) {
  return (
    <>
      {runs.map((r, i) => (
        <span key={i} style={{ fontWeight: r.bold ? 700 : undefined, fontStyle: r.italic ? "italic" : undefined }}>
          {r.text}
        </span>
      ))}
    </>
  );
}

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
        {l.blocks.length === 0 && <p style={{ ...text, color: "#999" }}>The letter text will appear here.</p>}
        {l.blocks.map((b, i) =>
          b.kind === "text" ? (
            <p key={i} style={{ ...text, textAlign: "justify" }}>
              {b.lines.map((line, j) => (
                <span key={j}>
                  {j > 0 && <br />}
                  <Runs runs={line} />
                </span>
              ))}
            </p>
          ) : (
            b.ordered ? (
              <ol key={i} style={{ ...text, paddingLeft: "1.6em" }}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Runs runs={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} style={{ ...text, paddingLeft: "1.6em" }}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Runs runs={item} />
                  </li>
                ))}
              </ul>
            )
          )
        )}

        {l.quote && (
          <div style={{ margin: "0 0 0.9em", fontSize: "0.92em" }}>
            <p style={{ margin: "0 0 0.2em", fontWeight: 700 }}>{l.quote.numberText}</p>
            {l.quote.validText && <p style={{ margin: "0 0 0.5em" }}>{l.quote.validText}</p>}
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "46%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "20%" }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#f0ede8" }}>
                  {["Description", "Qty", "Unit price", "VAT", "Total"].map((h, i) => (
                    <th key={h} style={{ border: "1px solid #bfbfbf", padding: "0.25em 0.4em", textAlign: i === 0 ? "left" : "right" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {l.quote.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ border: "1px solid #bfbfbf", padding: "0.4em", color: "#999" }}>
                      The quote lines will appear here.
                    </td>
                  </tr>
                )}
                {l.quote.rows.map((r, i) => (
                  <tr key={i}>
                    {[r.description, r.qty, r.unit, r.vat, r.total].map((t, j) => (
                      <td key={j} style={{ border: "1px solid #bfbfbf", padding: "0.25em 0.4em", textAlign: j === 0 ? "left" : "right", verticalAlign: "top" }}>
                        {t}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ textAlign: "right", marginTop: "0.5em", lineHeight: 1.5 }}>
              <div>Subtotal&nbsp;&nbsp;{l.quote.subtotal}</div>
              {l.quote.vatRows.map((v) => (
                <div key={v.label}>
                  {v.label}&nbsp;&nbsp;{v.amount}
                </div>
              ))}
              <div style={{ fontWeight: 700 }}>Total&nbsp;&nbsp;{l.quote.total}</div>
            </div>
            {l.quote.terms.length > 0 && (
              <div style={{ marginTop: "0.8em", fontSize: "0.95em" }}>
                {l.quote.terms.map((t, i) => (
                  <p key={i} style={{ margin: "0 0 0.3em" }}>
                    {t}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        {l.closing && <p style={{ ...text, marginBottom: 0 }}>{l.closing}</p>}
        <div style={{ marginTop: "0.4em" }}>
          {/* The signature picture takes the place of the two blank lines to sign in. It is only here once the letter may show one; a removed picture just leaves the space. */}
          {l.signerId && (
            <div style={{ position: "relative", height: "2.6em" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/letters/signers/${l.signerId}/image`}
                alt="Signature"
                onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                style={{ position: "absolute", left: 0, bottom: 0, maxHeight: "2.9em", maxWidth: "45%", mixBlendMode: "multiply" }}
              />
            </div>
          )}
          {(l.signerId ? l.signature.slice(2) : l.signature).map((line, i) => (
            <div key={i} style={{ fontWeight: i === (l.signerId ? 0 : 2) ? 700 : 400, minHeight: line ? undefined : "1.2em", color: line.startsWith("[") ? "#b3261e" : undefined }}>
              {line || " "}
            </div>
          ))}
        </div>

        {l.footer && <p style={{ marginTop: "2em", fontSize: "0.85em", color: "#777", whiteSpace: "pre-line" }}>{l.footer}</p>}
      </div>
    </div>
  );
}
