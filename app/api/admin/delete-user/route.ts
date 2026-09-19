import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: myProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (myProfile?.role !== "Admin") {
    return NextResponse.json({ error: "Only Admins can remove team members" }, { status: 403 });
  }

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  if (id === user.id) {
    return NextResponse.json({ error: "You can't remove your own account" }, { status: 400 });
  }

  const serviceClient = createServiceClient();

  const { error: deleteAuthError } = await serviceClient.auth.admin.deleteUser(id);

  if (deleteAuthError) {
    return NextResponse.json({ error: deleteAuthError.message }, { status: 500 });
  }

  await serviceClient.from("profiles").delete().eq("id", id);

  return NextResponse.json({ success: true });
}
