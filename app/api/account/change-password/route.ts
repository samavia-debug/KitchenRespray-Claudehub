import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setUserPassword, verifyPassword } from "@/lib/auth/accounts";
import { checkPassword } from "@/lib/auth/password-policy";

/**
 * Lets anyone signed in change their own password, whatever their role. The current password has to be given too, so
 * someone who finds a signed-in computer left open cannot lock the owner out.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { currentPassword?: unknown; newPassword?: unknown } | null;
  if (typeof body?.currentPassword !== "string" || !body.currentPassword) return NextResponse.json({ error: "Enter your current password" }, { status: 400 });

  const checked = checkPassword(body.newPassword, user.email);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  if (checked.value === body.currentPassword) return NextResponse.json({ error: "The new password must be different from the current one" }, { status: 400 });

  if (!(await verifyPassword(user.email, body.currentPassword))) {
    return NextResponse.json({ error: "Your current password is not right" }, { status: 400 });
  }
  if (!(await setUserPassword(user.id, checked.value))) return NextResponse.json({ error: "Could not change the password. Please try again." }, { status: 500 });
  return NextResponse.json({ success: true });
}
