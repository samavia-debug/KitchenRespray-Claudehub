import type { ConnecteamUser } from "./client";

export const CONNECTEAM_SOURCE = "connecteam";

export type StaffEntry = {
  entry_type: "person";
  title: string;
  content: string;
  tags: string[];
  status: "verified" | "archived";
  source: string;
  external_source: string;
  external_id: string;
};

const ACCESS_LEVEL_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  user: "Employee",
};

// Only these Connecteam custom fields are copied into Eleven. Birthday,
// gender, home address, pay type and overtime eligibility are deliberately
// absent — personal or pay data stays in Connecteam. Adding a field here is
// the only change needed to bring another one across.
const SYNCED_FIELDS: { name: string; label: string }[] = [
  { name: "Title", label: "Job title" },
  { name: "Role", label: "Role" },
  { name: "Department", label: "Department" },
  { name: "Team", label: "Team" },
  { name: "Branch", label: "Branch" },
  { name: "Employment Type", label: "Employment type" },
  { name: "Worker Type", label: "Worker type" },
  { name: "Employment Start Date", label: "Start date" },
  { name: "Employee ID", label: "Employee ID" },
];

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === "object" && "value" in item) return renderValue((item as { value: unknown }).value);
        return renderValue(item);
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function fullName(user: ConnecteamUser): string {
  return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
}

export function buildStaffEntry(user: ConnecteamUser, managerNameById: Map<number, string>): StaffEntry {
  const archived = !!user.isArchived;
  const lines: string[] = [];

  if (archived) lines.push("Former employee — archived in Connecteam.");

  const access = user.userType ? ACCESS_LEVEL_LABEL[user.userType] || user.userType : "";
  if (access) lines.push(`Connecteam access level: ${access}`);

  const fieldsByName = new Map((user.customFields ?? []).map((f) => [f.name, f]));
  for (const { name, label } of SYNCED_FIELDS) {
    const text = renderValue(fieldsByName.get(name)?.value);
    if (text) lines.push(`${label}: ${text}`);
  }

  const managerId = fieldsByName.get("Direct manager")?.value;
  if (typeof managerId === "number" && managerNameById.has(managerId)) {
    lines.push(`Direct manager: ${managerNameById.get(managerId)}`);
  }

  if (user.email) lines.push(`Email: ${user.email}`);
  if (user.phoneNumber) lines.push(`Phone: ${user.phoneNumber}`);

  return {
    entry_type: "person",
    title: fullName(user) || user.email || `Connecteam user ${user.userId}`,
    content: lines.join("\n"),
    tags: ["connecteam", "staff"],
    status: archived ? "archived" : "verified",
    source: "Connecteam (synced automatically — edits here are overwritten on the next sync)",
    external_source: CONNECTEAM_SOURCE,
    external_id: String(user.userId),
  };
}

export function buildStaffEntries(users: ConnecteamUser[]): StaffEntry[] {
  const managerNameById = new Map<number, string>();
  for (const u of users) {
    const name = fullName(u);
    if (name) managerNameById.set(u.userId, name);
  }
  return users.map((u) => buildStaffEntry(u, managerNameById));
}
