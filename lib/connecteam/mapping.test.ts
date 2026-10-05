import { describe, expect, it } from "vitest";
import { buildStaffEntries, buildStaffEntry, CONNECTEAM_SOURCE } from "./mapping";
import type { ConnecteamUser } from "./client";

const maria: ConnecteamUser = {
  userId: 101,
  firstName: "Maria",
  lastName: "Byrne",
  email: "maria@example.com",
  phoneNumber: "+353871234567",
  userType: "manager",
  isArchived: false,
  customFields: [
    { customFieldId: 1, name: "Title", type: "str", value: "Office Manager" },
    { customFieldId: 2, name: "Department", type: "dropdown", value: [{ id: 1, value: "Admin" }, { id: 2, value: "Accounts" }] },
    { customFieldId: 3, name: "Team", type: "dropdown", value: [{ id: 4, value: "Head Office" }] },
    { customFieldId: 4, name: "Direct manager", type: "directManager", value: 202 },
    { customFieldId: 5, name: "Employee ID", type: "str", value: "" },
    // Sensitive fields that must never be copied across:
    { customFieldId: 6, name: "Birthday", type: "birthday", value: "1985-02-03" },
    { customFieldId: 7, name: "Gender", type: "dropdown", value: [{ id: 1, value: "Female" }] },
    { customFieldId: 8, name: "Home address", type: "location", value: { address: "1 Secret Lane" } },
    { customFieldId: 9, name: "Pay Type", type: "dropdown", value: [{ id: 1, value: "Salaried" }] },
    { customFieldId: 10, name: "Overtime Eligibility", type: "dropdown", value: [{ id: 1, value: "Not eligible" }] },
  ],
};

const phil: ConnecteamUser = { userId: 202, firstName: "Philip", lastName: "Kane", userType: "owner", isArchived: false };

describe("buildStaffEntry", () => {
  it("builds a verified person entry keyed to the Connecteam user id", () => {
    const entry = buildStaffEntry(maria, new Map([[202, "Philip Kane"]]));
    expect(entry.entry_type).toBe("person");
    expect(entry.title).toBe("Maria Byrne");
    expect(entry.status).toBe("verified");
    expect(entry.external_source).toBe(CONNECTEAM_SOURCE);
    expect(entry.external_id).toBe("101");
  });

  it("renders dropdown values as readable text and resolves the direct manager's name", () => {
    const { content } = buildStaffEntry(maria, new Map([[202, "Philip Kane"]]));
    expect(content).toContain("Job title: Office Manager");
    expect(content).toContain("Department: Admin, Accounts");
    expect(content).toContain("Team: Head Office");
    expect(content).toContain("Direct manager: Philip Kane");
    expect(content).toContain("Connecteam access level: Manager");
    expect(content).toContain("Email: maria@example.com");
    expect(content).toContain("Phone: +353871234567");
  });

  it("never copies birthday, gender, home address, pay or overtime data", () => {
    const { content } = buildStaffEntry(maria, new Map());
    for (const secret of ["1985", "Female", "Secret Lane", "Salaried", "Not eligible", "Birthday", "Pay"]) {
      expect(content).not.toContain(secret);
    }
  });

  it("skips empty fields and an unresolvable manager instead of printing blanks", () => {
    const { content } = buildStaffEntry(maria, new Map());
    expect(content).not.toContain("Employee ID");
    expect(content).not.toContain("Direct manager");
  });

  it("marks archived staff as former employees", () => {
    const entry = buildStaffEntry({ ...maria, isArchived: true }, new Map());
    expect(entry.status).toBe("archived");
    expect(entry.content.startsWith("Former employee")).toBe(true);
  });

  it("falls back to email, then the user id, when a person has no name", () => {
    expect(buildStaffEntry({ userId: 5, email: "a@b.ie" }, new Map()).title).toBe("a@b.ie");
    expect(buildStaffEntry({ userId: 5 }, new Map()).title).toBe("Connecteam user 5");
  });
});

describe("buildStaffEntries", () => {
  it("resolves managers across the whole list, including archived people", () => {
    const entries = buildStaffEntries([maria, phil]);
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toContain("Direct manager: Philip Kane");
  });
});
