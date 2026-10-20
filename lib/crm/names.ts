/** "joanna.byrne@x.ie" -> "Joanna Byrne" (the team is identified by email in this dashboard). */
export function personName(email: string | null | undefined): string {
  if (!email) return "Unassigned";
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
