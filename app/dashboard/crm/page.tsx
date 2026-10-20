import { redirect } from "next/navigation";

// The Overview arrives with the reports; until then the working screen is the company list.
export default function CrmHome() {
  redirect("/dashboard/crm/companies");
}
