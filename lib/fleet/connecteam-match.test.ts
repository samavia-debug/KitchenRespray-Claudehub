import { describe, expect, it } from "vitest";
import { datesForPerson, dateOfEpoch, findVanDocuments, suggestPerson, type Person } from "./connecteam-match";

const people: Person[] = [
  { id: 1, name: "S Erin Kennedy" },
  { id: 2, name: "K Marius Emilian" },
  { id: 3, name: "B Mike Olds" },
  { id: 4, name: "K Alex Koufalis" },
  { id: 5, name: "K Alex Vrajitoru" },
  { id: 6, name: "K Chris Finn" },
  { id: 7, name: "Z Philip Mckinney" },
  { id: 8, name: "M Issa Aitelatabi" },
];

describe("finding the van documents in Connecteam", () => {
  it("picks tax, DOE and insurance by name and ignores other documents", () => {
    const found = findVanDocuments([
      { documentId: 10, name: "Safe Pass" },
      { documentId: 284396, name: "Van tax" },
      { documentId: 367516, name: "Van DOE" },
      { documentId: 696676, name: "Van insurance" },
      { documentId: 284395, name: "Company El & PL Insurance Cert" },
      { documentId: 366711, name: "Fuel card" },
    ]);
    expect(found).toEqual({ tax: 284396, doe: 367516, insurance: 696676 });
  });

  it("leaves out a kind that has no document", () => {
    expect(findVanDocuments([{ documentId: 1, name: "van tax " }])).toEqual({ tax: 1 });
  });
});

describe("matching a van's driver to a person in Connecteam", () => {
  it("matches a first name, with or without a trailing dot or spaces", () => {
    expect(suggestPerson("Mike.", people)?.id).toBe(3);
    expect(suggestPerson("erin", people)?.id).toBe(1);
    expect(suggestPerson("Issa", people)?.id).toBe(8);
    expect(suggestPerson("Philip", people)?.id).toBe(7);
    expect(suggestPerson("Marius .", people)?.id).toBe(2);
  });

  it("does not guess between two people with the same first name", () => {
    expect(suggestPerson("Alex.", people)).toBeNull();
    expect(suggestPerson("Kalex", people)).toBeNull();
  });

  it("reads a group letter run onto the name when that picks one person", () => {
    expect(suggestPerson("Kchris", people)?.id).toBe(6);
  });

  it("matches nothing for a nickname, a spare van or a missing driver", () => {
    expect(suggestPerson("Christopher.", people)).toBeNull();
    expect(suggestPerson("Spare", people)).toBeNull();
    expect(suggestPerson("Big van", people)).toBeNull();
    expect(suggestPerson("M", people)).toBeNull();
    expect(suggestPerson(null, people)).toBeNull();
    expect(suggestPerson("", people)).toBeNull();
  });

  it("is not thrown by accents and capitals", () => {
    expect(suggestPerson("ÉRIN", people)?.id).toBe(1);
  });
});

describe("dates from Connecteam", () => {
  it("turns seconds into a plain date, and nothing into nothing", () => {
    expect(dateOfEpoch(1_790_000_000)).toBe("2026-09-21");
    expect(dateOfEpoch(undefined)).toBeNull();
    expect(dateOfEpoch(0)).toBeNull();
    expect(dateOfEpoch(Number.NaN)).toBeNull();
  });

  it("reads each kind of date for one person and leaves out a kind with no date", () => {
    const rows = [
      { userId: 3, documentId: 100, expiresAt: 1_790_000_000 },
      { userId: 3, documentId: 200, expiresAt: 1_800_000_000 },
      { userId: 3, documentId: 300 },
      { userId: 4, documentId: 100, expiresAt: 1_700_000_000 },
    ];
    expect(datesForPerson(rows, 3, { tax: 100, doe: 200, insurance: 300 })).toEqual({ tax: "2026-09-21", doe: "2027-01-15" });
    expect(datesForPerson(rows, 9, { tax: 100 })).toEqual({});
  });
});
