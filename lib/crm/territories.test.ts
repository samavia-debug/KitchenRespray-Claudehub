import { describe, expect, it } from "vitest";
import { COUNTY_CHOICES, LEINSTER_COUNTIES, normalizeCounty, OUTSIDE_LEINSTER } from "./territories";

// The same table is checked against the migration that tidies existing records (see 20261025100000_crm_territories.sql),
// so what is typed in today and what was typed in before are read the same way.
const COUNTY_CASES: [string, string | null][] = [
  ["Carlow", "Carlow"],
  ["carlow", "Carlow"],
  ["  CARLOW  ", "Carlow"],
  ["Co. Carlow", "Carlow"],
  ["Co Carlow", "Carlow"],
  ["Co.Carlow", "Carlow"],
  ["County Carlow", "Carlow"],
  ["Carlow, Co.", "Carlow"],
  ["Carlow County", "Carlow"],
  ["Kilkenny", "Kilkenny"],
  ["co. kilkenny", "Kilkenny"],
  ["Kildare", "Kildare"],
  ["Laois", "Laois"],
  ["Laoighis", "Laois"],
  ["Queens County", "Laois"],
  ["Offaly", "Offaly"],
  ["Kings County", "Offaly"],
  ["Westmeath", "Westmeath"],
  ["West Meath", "Westmeath"],
  ["Longford", "Longford"],
  ["Louth", "Louth"],
  ["Meath", "Meath"],
  ["Wexford", "Wexford"],
  ["Wicklow", "Wicklow"],
  ["Dublin", "Dublin"],
  ["Co. Dublin", "Dublin"],
  ["County Dublin", "Dublin"],
  ["Dublin 4", "Dublin"],
  ["Dublin 04", "Dublin"],
  ["Dublin 6W", "Dublin"],
  ["Dublin 24", "Dublin"],
  ["Dublin City", "Dublin"],
  ["South Dublin", "Dublin"],
  ["Fingal", "Dublin"],
  ["D04", "Dublin"],
  ["D6W", "Dublin"],
  ["D24", "Dublin"],
  ["Dún Laoghaire", "Dublin"],
  ["Dun Laoghaire-Rathdown", "Dublin"],
  ["Cork", "Outside Leinster"],
  ["Co. Cork", "Outside Leinster"],
  ["Galway", "Outside Leinster"],
  ["Tipperary", "Outside Leinster"],
  ["Antrim", "Outside Leinster"],
  ["Northern Ireland", "Outside Leinster"],
  ["Outside Leinster", "Outside Leinster"],
  ["Dublin 25", null],
  ["Dublin 0", null],
  ["Narnia", null],
  ["Carlow Town", null],
  ["Meath Road, Bray", null],
  ["12", null],
  ["", null],
  ["   ", null],
  ["Co.", null],
];

describe("normalizeCounty", () => {
  for (const [input, expected] of COUNTY_CASES) {
    it(`reads ${JSON.stringify(input)} as ${JSON.stringify(expected)}`, () => {
      expect(normalizeCounty(input)).toBe(expected);
    });
  }

  it("treats nothing as not set", () => {
    expect(normalizeCounty(null)).toBeNull();
    expect(normalizeCounty(undefined)).toBeNull();
  });

  it("lists the twelve Leinster counties, then Outside Leinster", () => {
    expect(LEINSTER_COUNTIES).toHaveLength(12);
    expect(COUNTY_CHOICES).toEqual([...LEINSTER_COUNTIES, OUTSIDE_LEINSTER]);
  });

  it("gives back only values from the list", () => {
    for (const [input] of COUNTY_CASES) {
      const out = normalizeCounty(input);
      if (out !== null) expect(COUNTY_CHOICES).toContain(out);
    }
  });
});
