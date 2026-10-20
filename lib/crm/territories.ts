// Territories: the twelve counties of Leinster. A company's county is one of these, "Outside Leinster", or not set, so the
// CRM can show every county side by side and offers can later differ by county.

export const LEINSTER_COUNTIES = ["Carlow", "Dublin", "Kildare", "Kilkenny", "Laois", "Longford", "Louth", "Meath", "Offaly", "Westmeath", "Wexford", "Wicklow"] as const;
export type LeinsterCounty = (typeof LEINSTER_COUNTIES)[number];

/** Somewhere in Ireland other than Leinster (or Northern Ireland): a real place, just not one of our territories. */
export const OUTSIDE_LEINSTER = "Outside Leinster";

/** Every value a company's county can hold. The database enforces the same list. */
export const COUNTY_CHOICES: string[] = [...LEINSTER_COUNTIES, OUTSIDE_LEINSTER];

/** The filter value for "no county set". */
export const NO_COUNTY = "none";

const OTHER_PLACES = [
  "cavan", "clare", "cork", "donegal", "galway", "kerry", "leitrim", "limerick", "mayo", "monaghan", "roscommon", "sligo", "tipperary", "waterford",
  "antrim", "armagh", "down", "fermanagh", "derry", "londonderry", "tyrone", "northern ireland",
];

/** Other ways the same county is written. Each is the whole value once "Co." and "County" have been taken off. */
const ALIASES: Record<string, LeinsterCounty> = {
  "west meath": "Westmeath",
  laoighis: "Laois",
  leix: "Laois",
  "queens county": "Laois",
  "kings county": "Offaly",
  "south dublin": "Dublin",
  fingal: "Dublin",
  "dublin city": "Dublin",
  dlr: "Dublin",
};

// Dublin is also written as a postal district ("Dublin 4", "Dublin 6W") or by the first part of its Eircode ("D04", "D6W").
const DUBLIN_DISTRICT = /^(dublin\s*(0?[1-9]|1\d|2[0-4]|6w)|d(0?[1-9]|1\d|2[0-4]|6w))$/;
const DUN_LAOGHAIRE = /^dun laoghaire(\s*-?\s*rathdown)?$/;

/**
 * The county a typed value means: one of the twelve, "Outside Leinster", or null when it is not a county we recognise.
 * Empty input is also null (not set). The same rules are in the migration that tidies existing records
 * (20261025100000_crm_territories.sql); territories.test.ts holds the table both are checked against.
 */
export function normalizeCounty(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let v = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // "Queens County" is a name in its own right, so it is tried as written before "County" is taken off.
  const stripped = v.replace(/^(county|co) /, "").replace(/ (county|co)$/, "").trim();
  for (const candidate of [v, stripped]) if (candidate && Object.prototype.hasOwnProperty.call(ALIASES, candidate)) return ALIASES[candidate];
  v = stripped;
  if (!v) return null;

  const exact = LEINSTER_COUNTIES.find((c) => c.toLowerCase() === v);
  if (exact) return exact;
  if (DUBLIN_DISTRICT.test(v) || DUN_LAOGHAIRE.test(v)) return "Dublin";
  if (OTHER_PLACES.includes(v) || v === OUTSIDE_LEINSTER.toLowerCase()) return OUTSIDE_LEINSTER;
  return null;
}
