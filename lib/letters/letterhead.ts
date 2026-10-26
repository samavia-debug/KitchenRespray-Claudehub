// The company letterhead is artwork on an A4 page (public/letterhead.png, made from the company's letterhead PDF):
// a logo and header bar across the top and a contact bar along the bottom. Letters are printed and exported over
// it, so the letter's own text has to stay between the two bars. The measures are in millimetres on the page; the
// header ends about 51 mm down and the footer starts about 279 mm down.

export const LETTERHEAD = {
  src: "/letterhead.png",
  pageWidthMm: 210,
  pageHeightMm: 297,
  /** Clear of the logo and header bar. */
  topMm: 56,
  /** Clear of the contact bar along the bottom. */
  bottomMm: 24,
  sideMm: 20,
} as const;

const pct = (mm: number) => `${((mm / LETTERHEAD.pageWidthMm) * 100).toFixed(3)}%`;

/** The same margins as shares of the page width (CSS padding percentages are of the width), for the on-screen sheet. */
export const SHEET_PADDING = `${pct(LETTERHEAD.topMm)} ${pct(LETTERHEAD.sideMm)} ${pct(LETTERHEAD.bottomMm)}`;

/** Twentieths of a point (a Word "twip") for a length in millimetres. */
export const mmToTwips = (mm: number) => Math.round((mm / 25.4) * 1440);

/** English Metric Units (what Word measures a picture in) for a length in millimetres. */
export const mmToEmu = (mm: number) => Math.round(mm * 36000);
