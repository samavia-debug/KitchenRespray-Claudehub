import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { setUserPassword } from "@/lib/auth/accounts";
import { generatePassword } from "@/lib/auth/password-generate";
import { checkPassword } from "@/lib/auth/password-policy";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An Admin sets a team member's password: either one they type (`newPassword`) or, if none is given, a temporary one made
 * here and shown once. Someone's own password is changed from My account, which asks for the current one.
 */
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
    return NextResponse.json({ error: "Only Admins can reset passwords" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { id?: unknown; newPassword?: unknown } | null;
  const id = body?.id;

  if (typeof id !== "string" || !UUID.test(id)) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }
  if (id === user.id) {
    return NextResponse.json({ error: "Change your own password from My account, where you confirm the current one" }, { status: 400 });
  }

  const { data: target } = await createServiceClient().from("profiles").select("email").eq("id", id).maybeSingle();
  if (!target) return NextResponse.json({ error: "That team member was not found" }, { status: 404 });

  const typed = body?.newPassword !== undefined && body.newPassword !== null && body.newPassword !== "";
  let password: string;
  if (typed) {
    const checked = checkPassword(body?.newPassword, target.email);
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
    password = checked.value;
  } else {
    password = generatePassword();
  }

  if (!(await setUserPassword(id, password))) return NextResponse.json({ error: "Could not reset the password" }, { status: 500 });
  // A password the Admin typed is not sent back: they already know it. A generated one is shown once.
  return NextResponse.json(typed ? { success: true } : { success: true, tempPassword: password });
}
