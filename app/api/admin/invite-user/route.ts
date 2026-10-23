import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generatePassword } from "@/lib/auth/password-generate";
import { checkPassword } from "@/lib/auth/password-policy";

const VALID_ROLES = ["Admin", "Manager", "Staff", "Viewer"];

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
    return NextResponse.json({ error: "Only Admins can add team members" }, { status: 403 });
  }

  const { email, role, password } = await request.json();

  if (!email || !role) {
    return NextResponse.json({ error: "Missing email or role" }, { status: 400 });
  }

  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` }, { status: 400 });
  }

  // The Admin may choose the first password; otherwise one is made and shown once.
  const typed = typeof password === "string" && password !== "";
  let initial: string;
  if (typed) {
    const checked = checkPassword(password, email);
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
    initial = checked.value;
  } else {
    initial = generatePassword();
  }
  const serviceClient = createServiceClient();

  const { data: newUser, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password: initial,
    email_confirm: true,
  });

  if (createError || !newUser.user) {
    return NextResponse.json(
      { error: createError?.message || "Failed to create user" },
      { status: 500 }
    );
  }

  const { error: profileError } = await serviceClient.from("profiles").insert({
    id: newUser.user.id,
    email: email,
    role: role,
  });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  return NextResponse.json(typed ? { success: true } : { success: true, tempPassword: initial });
}
