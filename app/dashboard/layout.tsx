import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";
import SidebarNav from "./sidebar-nav";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">KitchenRespray Hub</div>
        <SidebarNav />
      </aside>
      <div style={{ flex: 1 }}>
        <div className="topbar">
          <SignOutButton />
        </div>
        <main className="main-area">{children}</main>
      </div>
    </div>
  );
}
