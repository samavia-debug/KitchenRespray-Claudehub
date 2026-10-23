import { beforeEach, describe, expect, it, vi } from "vitest";

// The password routes, called as the real handlers with the sign-in service stood in for.

const state = vi.hoisted(() => ({
  user: null as null | { id: string; email: string | null },
  role: null as null | string,
  /** The profile of the person an Admin is acting on. */
  target: null as null | { email: string },
  currentPassword: "Current-pass-1",
  updateError: null as null | { message: string },
  updates: [] as { id: string; attrs: any }[],
  created: [] as any[],
  profilesInserted: [] as any[],
  exchange: { error: null as null | { message: string }, codes: [] as string[] },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
      exchangeCodeForSession: async (code: string) => {
        state.exchange.codes.push(code);
        return { error: state.exchange.error };
      },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: state.role ? { role: state.role } : null }) }) }) }),
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    auth: {
      admin: {
        updateUserById: async (id: string, attrs: any) => {
          state.updates.push({ id, attrs });
          return { error: state.updateError };
        },
        createUser: async (attrs: any) => {
          state.created.push(attrs);
          return { data: { user: { id: "new-user-id" } }, error: null };
        },
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.target }) }) }),
      insert: async (row: any) => {
        state.profilesInserted.push(row);
        return { error: null };
      },
    }),
  }),
}));

// verifyPassword signs in with a throwaway client; it is told here which password is the right one.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async ({ password }: { email: string; password: string }) =>
        password === state.currentPassword ? { data: { user: { id: "u" } }, error: null } : { data: { user: null }, error: { message: "Invalid login credentials" } },
      signOut: async () => ({ error: null }),
    },
  }),
}));

import { GET as callback } from "../../app/auth/callback/route";
import { POST as invite } from "../../app/api/admin/invite-user/route";
import { POST as reset } from "../../app/api/admin/reset-password/route";
import { POST as change } from "../../app/api/account/change-password/route";
import { checkPassword } from "./password-policy";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as any;
const signIn = (role: string, email = "joanna@example.ie") => {
  state.user = { id: ME, email };
  state.role = role;
};

beforeEach(() => {
  state.user = null;
  state.role = null;
  state.target = null;
  state.currentPassword = "Current-pass-1";
  state.updateError = null;
  state.updates = [];
  state.created = [];
  state.profilesInserted = [];
  state.exchange = { error: null, codes: [] };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("changing your own password", () => {
  const go = (body: unknown) => change(post("/api/account/change-password", body));

  it("is for people who are signed in, whatever their role", async () => {
    expect((await go({ currentPassword: "Current-pass-1", newPassword: "A-new-one-22" })).status).toBe(401);
    for (const role of ["Viewer", "Staff", "Manager", "Admin"]) {
      signIn(role);
      expect((await go({ currentPassword: "Current-pass-1", newPassword: "A-new-one-22" })).status, role).toBe(200);
    }
  });

  it("changes the signed-in person's own password, and nobody else's", async () => {
    signIn("Staff");
    const res = await go({ currentPassword: "Current-pass-1", newPassword: "A-new-one-22" });
    expect(await res.json()).toEqual({ success: true });
    expect(state.updates).toEqual([{ id: ME, attrs: { password: "A-new-one-22" } }]);
  });

  it("needs the current password, and refuses a wrong one without changing anything", async () => {
    signIn("Staff");
    expect((await go({ newPassword: "A-new-one-22" })).status).toBe(400);
    expect((await go({ currentPassword: "", newPassword: "A-new-one-22" })).status).toBe(400);
    const wrong = await go({ currentPassword: "Not-the-one-9", newPassword: "A-new-one-22" });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "Your current password is not right" });
    expect(state.updates).toEqual([]);
  });

  it("refuses a weak or unchanged new password without changing anything", async () => {
    signIn("Staff");
    for (const newPassword of ["short", "Password123", "joanna@example.ie", "Current-pass-1", "", undefined, 12345678, ["a"]]) {
      expect((await go({ currentPassword: "Current-pass-1", newPassword })).status, String(newPassword)).toBe(400);
    }
    expect(state.updates).toEqual([]);
  });

  it("copes with a body that is not JSON", async () => {
    signIn("Staff");
    const res = await change(new Request("http://localhost/api/account/change-password", { method: "POST", body: "nope" }) as any);
    expect(res.status).toBe(400);
  });

  it("gives a plain message, not the service's own words, if the change fails", async () => {
    signIn("Staff");
    state.updateError = { message: "AuthApiError: secret internal detail" };
    const res = await go({ currentPassword: "Current-pass-1", newPassword: "A-new-one-22" });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });
});

describe("an Admin resetting a team member's password", () => {
  const go = (body: unknown) => reset(post("/api/admin/reset-password", body));
  beforeEach(() => {
    signIn("Admin", "philip@example.ie");
    state.target = { email: "sajad@example.ie" };
  });

  it("is only for Admins", async () => {
    state.user = null;
    expect((await go({ id: THEM })).status).toBe(401);
    for (const role of ["Viewer", "Staff", "Manager"]) {
      signIn(role);
      expect((await go({ id: THEM })).status, role).toBe(403);
    }
    expect(state.updates).toEqual([]);
  });

  it("sets the password the Admin typed, and does not send it back", async () => {
    const res = await go({ id: THEM, newPassword: "Chosen-by-admin-5" });
    expect(await res.json()).toEqual({ success: true });
    expect(state.updates).toEqual([{ id: THEM, attrs: { password: "Chosen-by-admin-5" } }]);
  });

  it("makes a temporary one, shown once, when none is typed", async () => {
    for (const blank of [{ id: THEM }, { id: THEM, newPassword: "" }, { id: THEM, newPassword: null }]) {
      state.updates = [];
      const body = await (await go(blank)).json();
      expect(body.success).toBe(true);
      expect(checkPassword(body.tempPassword)).toHaveProperty("value");
      expect(state.updates).toEqual([{ id: THEM, attrs: { password: body.tempPassword } }]);
    }
  });

  it("refuses a weak password, or the person's own email, without changing anything", async () => {
    for (const newPassword of ["short", "Password123", "sajad@example.ie", "sajad", 5, ["x"]]) {
      expect((await go({ id: THEM, newPassword })).status, String(newPassword)).toBe(400);
    }
    expect(state.updates).toEqual([]);
  });

  it("refuses a missing or invalid id, an unknown member, and the Admin's own account", async () => {
    for (const id of [undefined, "", "nope", 5, "../../etc"]) expect((await go({ id })).status, String(id)).toBe(400);
    state.target = null;
    expect((await go({ id: THEM })).status).toBe(404);
    const self = await go({ id: ME });
    expect(self.status).toBe(400);
    expect((await self.json()).error).toContain("My account");
    expect(state.updates).toEqual([]);
  });

  it("gives a plain message if the reset fails", async () => {
    state.updateError = { message: "internal detail" };
    const res = await go({ id: THEM });
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("internal");
  });
});

describe("an Admin adding a team member", () => {
  const go = (body: unknown) => invite(post("/api/admin/invite-user", body));
  beforeEach(() => signIn("Admin"));

  it("is only for Admins", async () => {
    for (const role of ["Viewer", "Staff", "Manager"]) {
      signIn(role);
      expect((await go({ email: "a@b.ie", role: "Staff" })).status, role).toBe(403);
    }
    expect(state.created).toEqual([]);
  });

  it("uses the password the Admin typed and does not send it back", async () => {
    const res = await go({ email: "erin@example.ie", role: "Staff", password: "Chosen-first-5" });
    expect(await res.json()).toEqual({ success: true });
    expect(state.created).toEqual([{ email: "erin@example.ie", password: "Chosen-first-5", email_confirm: true }]);
    expect(state.profilesInserted).toEqual([{ id: "new-user-id", email: "erin@example.ie", role: "Staff" }]);
  });

  it("makes a temporary one, shown once, when none is typed", async () => {
    const body = await (await go({ email: "mo@example.ie", role: "Staff" })).json();
    expect(checkPassword(body.tempPassword)).toHaveProperty("value");
    expect(state.created[0].password).toBe(body.tempPassword);
  });

  it("refuses a weak typed password before creating anything, and an unknown role", async () => {
    expect((await go({ email: "mo@example.ie", role: "Staff", password: "short" })).status).toBe(400);
    expect((await go({ email: "mo@example.ie", role: "Staff", password: "mo@example.ie" })).status).toBe(400);
    expect((await go({ email: "mo@example.ie", role: "Boss" })).status).toBe(400);
    expect((await go({ role: "Staff" })).status).toBe(400);
    expect(state.created).toEqual([]);
  });
});

describe("the link in a password-reset email", () => {
  const open = (query: string) => callback(new Request(`https://hub.example.ie/auth/callback${query}`) as any);
  const where = (res: Response) => res.headers.get("location");

  it("signs the person in with the code and sends them to choose a new password", async () => {
    const res = await open("?code=abc123&next=/reset-password");
    expect(where(res)).toBe("https://hub.example.ie/reset-password");
    expect(state.exchange.codes).toEqual(["abc123"]);
  });

  it("will not send the person anywhere else, whatever the link says", async () => {
    for (const next of ["https://evil.example", "//evil.example", "/dashboard/settings", "\\\\evil", "javascript:alert(1)", ""]) {
      expect(where(await open(`?code=abc&next=${encodeURIComponent(next)}`)), next).toBe("https://hub.example.ie/dashboard");
    }
  });

  it("sends the person back to sign in, with a note, when the link has no code or the code does not work", async () => {
    expect(where(await open(""))).toBe("https://hub.example.ie/login?error=link");
    state.exchange.error = { message: "invalid flow state" };
    expect(where(await open("?code=used&next=/reset-password"))).toBe("https://hub.example.ie/login?error=link");
  });
});
