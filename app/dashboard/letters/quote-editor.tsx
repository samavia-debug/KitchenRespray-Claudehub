"use client";

import { DEFAULT_VAT_RATE, VAT_RATES, addDays, defaultTerms, euro, quoteTotals, vatText, type Quote, type QuoteLine } from "@/lib/letters/quote";

const blankLine = (): QuoteLine => ({ description: "", qty: 1, unit_price: 0, vat_rate: DEFAULT_VAT_RATE });

/** A new quote: valid for 30 days, with the usual notes. */
export function newQuote(today: string): Quote {
  const valid = addDays(today, 30);
  return { number: "", valid_until: valid, terms: defaultTerms(valid), lines: [blankLine()] };
}

/** The lines of a quote, with what each comes to and the totals as they are typed. */
export default function QuoteEditor({ quote, onChange, locked }: { quote: Quote; onChange: (q: Quote) => void; locked: boolean }) {
  const totals = quoteTotals(quote.lines);

  const setLine = (i: number, patch: Partial<QuoteLine>) => onChange({ ...quote, lines: quote.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const num = (v: string): number => (v === "" ? 0 : Number(v));

  function setValidUntil(date: string) {
    // The usual notes follow the date; notes that have been changed by hand are left alone.
    const usual = quote.terms.trim() === defaultTerms(quote.valid_until).trim() || quote.terms.trim() === "";
    onChange({ ...quote, valid_until: date, terms: usual ? defaultTerms(date) : quote.terms });
  }

  return (
    <div style={{ margin: "0.75rem 0 1rem" }}>
      <h3 style={{ margin: "0 0 0.5rem" }}>Quote lines</h3>
      <p style={{ margin: "0 0 0.5rem", fontSize: "0.8rem", color: "var(--muted)" }}>
        Enter each price without VAT; the VAT and the total are worked out below. The VAT rate for each line is for you and the financial controller to confirm.
        {quote.number && ` This quote is number ${quote.number}.`}
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ minWidth: 200 }}>Description</th>
              <th style={{ width: 80 }}>Qty</th>
              <th style={{ width: 120 }}>Price (ex VAT)</th>
              <th style={{ width: 90 }}>VAT</th>
              <th style={{ width: 110, textAlign: "right" }}>Line total</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <input value={l.description} disabled={locked} placeholder="e.g. Respray 12 kitchen doors" onChange={(e) => setLine(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} />
                </td>
                <td>
                  <input type="number" min={0} step="0.01" value={l.qty} disabled={locked} onChange={(e) => setLine(i, { qty: num(e.target.value) })} aria-label={`Line ${i + 1} quantity`} />
                </td>
                <td>
                  <input type="number" step="0.01" value={l.unit_price} disabled={locked} onChange={(e) => setLine(i, { unit_price: num(e.target.value) })} aria-label={`Line ${i + 1} price`} />
                </td>
                <td>
                  <select value={l.vat_rate} disabled={locked} onChange={(e) => setLine(i, { vat_rate: Number(e.target.value) })} aria-label={`Line ${i + 1} VAT rate`}>
                    {VAT_RATES.map((r) => (
                      <option key={r} value={r}>
                        {vatText(r)}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: "right" }}>{euro(totals.lineNet[i] ?? 0)}</td>
                <td>
                  {!locked && (
                    <button type="button" className="btn btn-secondary" style={{ padding: "0.1rem 0.45rem" }} title="Remove this line" onClick={() => onChange({ ...quote, lines: quote.lines.filter((_, j) => j !== i) })}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!locked && (
        <button type="button" className="btn btn-secondary" style={{ marginTop: "0.5rem" }} onClick={() => onChange({ ...quote, lines: [...quote.lines, blankLine()] })}>
          Add a line
        </button>
      )}

      <div style={{ textAlign: "right", marginTop: "0.75rem", lineHeight: 1.6 }}>
        <div>Subtotal: {euro(totals.subtotal)}</div>
        {totals.vat.map((r) => (
          <div key={r.rate}>
            VAT at {vatText(r.rate)} on {euro(r.net)}: {euro(r.vat)}
          </div>
        ))}
        <div style={{ fontWeight: 700 }}>Total: {euro(totals.total)}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", marginTop: "0.75rem" }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Valid until</label>
          <input type="date" value={quote.valid_until} disabled={locked} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>
      <div className="field" style={{ marginTop: "0.75rem" }}>
        <label>Notes under the quote (one per line)</label>
        <textarea rows={4} value={quote.terms} disabled={locked} onChange={(e) => onChange({ ...quote, terms: e.target.value })} />
      </div>
    </div>
  );
}
