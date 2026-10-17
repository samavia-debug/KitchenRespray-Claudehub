import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstNameOf, graphDateToSec, normaliseAppointments, shiftTitle, type RawAppointment } from "./appointments";
import { appointmentAssignees, appointmentSchedulerIdFromEnv, assigneesFor, bookingsWriteEnabled, extraSchedulerRefs, graphConfig, hasAssignments, isAppointmentScheduler, isBookingCopy, serviceAssignees, serviceLabels } from "./config";
import { fetchBookingAppointments, resetGraphTokenCache, tokenRoles } from "./graph";
import { PLAN_LIMITS, planSync, signatureOf, type DesiredShift, type ShiftLink } from "./plan";
import { createdShiftId, shiftPayload, shiftUpdatePayload } from "../connecteam/shifts-write";
import { customerDetails, escapeHtml, notesHtml } from "./details";

describe("appointment times", () => {
  const sec = (iso: string) => Date.parse(iso) / 1000;

  it("reads UTC times, including Microsoft's seven decimal places", () => {
    expect(graphDateToSec({ dateTime: "2026-10-20T10:00:00.0000000", timeZone: "UTC" })).toBe(sec("2026-10-20T10:00:00Z"));
    expect(graphDateToSec({ dateTime: "2026-10-20T10:30", timeZone: "UTC" })).toBe(sec("2026-10-20T10:30:00Z"));
  });

  it("converts Irish time either side of the clocks changing", () => {
    // Summer time (UTC+1) and winter time (UTC+0).
    expect(graphDateToSec({ dateTime: "2026-10-20T10:00:00", timeZone: "Europe/Dublin" })).toBe(sec("2026-10-20T09:00:00Z"));
    expect(graphDateToSec({ dateTime: "2026-12-01T10:00:00", timeZone: "GMT Standard Time" })).toBe(sec("2026-12-01T10:00:00Z"));
    // Clocks go forward at 01:00 UTC on 29 March 2026.
    expect(graphDateToSec({ dateTime: "2026-03-29T00:30:00", timeZone: "Europe/Dublin" })).toBe(sec("2026-03-29T00:30:00Z"));
    expect(graphDateToSec({ dateTime: "2026-03-29T02:30:00", timeZone: "Europe/Dublin" })).toBe(sec("2026-03-29T01:30:00Z"));
    // Clocks go back at 01:00 UTC on 25 October 2026.
    expect(graphDateToSec({ dateTime: "2026-10-25T03:00:00", timeZone: "Europe/Dublin" })).toBe(sec("2026-10-25T03:00:00Z"));
  });

  it("refuses zones and dates it does not understand rather than guessing", () => {
    expect(graphDateToSec({ dateTime: "2026-10-20T10:00:00", timeZone: "Pacific Standard Time" })).toBeNull();
    expect(graphDateToSec({ dateTime: "2026-11-31T10:00:00", timeZone: "UTC" })).toBeNull();
    expect(graphDateToSec({ dateTime: "2026-10-20T25:00:00", timeZone: "UTC" })).toBeNull();
    expect(graphDateToSec({ dateTime: "soon", timeZone: "UTC" })).toBeNull();
    expect(graphDateToSec({ dateTime: "2026-10-20T10:00:00" })).toBeNull();
    expect(graphDateToSec(undefined)).toBeNull();
  });
});

describe("customer first names", () => {
  it("passes on a first name only", () => {
    expect(firstNameOf("Mary O'Brien")).toBe("Mary");
    expect(firstNameOf("Mr John Smith")).toBe("John");
    expect(firstNameOf("Dr. Seán Ó Briain")).toBe("Seán");
    expect(firstNameOf("  anne-marie   Kelly ")).toBe("anne-marie");
  });

  it("drops anything that is not a usable name", () => {
    expect(firstNameOf("")).toBeNull();
    expect(firstNameOf(undefined)).toBeNull();
    expect(firstNameOf("J")).toBeNull();
    expect(firstNameOf("12345")).toBeNull();
    expect(firstNameOf("Mr")).toBeNull();
    expect(firstNameOf("<script>alert(1)</script> Bob")).toBe("scriptalertscript");
  });
});

describe("normaliseAppointments", () => {
  const ok = (id: string, start: string, extra: Partial<RawAppointment> = {}): RawAppointment => ({
    id,
    serviceName: "Kylemore",
    startDateTime: { dateTime: start, timeZone: "UTC" },
    endDateTime: { dateTime: start.replace("10:00", "10:30"), timeZone: "UTC" },
    customers: [{ name: "Mary O'Brien" }],
    ...extra,
  });

  it("keeps usable appointments in time order and counts the ones it cannot use", () => {
    const raw: RawAppointment[] = [
      ok("b", "2026-10-21T10:00:00"),
      ok("a", "2026-10-20T10:00:00"),
      ok("cancelled", "2026-10-20T11:00:00", { isCancelled: true }),
      { id: "no-time", serviceName: "Bray" },
      ok("bad-zone", "2026-10-20T10:00:00", { startDateTime: { dateTime: "2026-10-20T10:00:00", timeZone: "Mars" } }),
      { ...ok("ends-before", "2026-10-20T10:00:00"), endDateTime: { dateTime: "2026-10-20T09:00:00", timeZone: "UTC" } },
      { serviceName: "Bray", startDateTime: { dateTime: "2026-10-20T10:00:00", timeZone: "UTC" }, endDateTime: { dateTime: "2026-10-20T10:30:00", timeZone: "UTC" } },
    ];
    const r = normaliseAppointments(raw);
    expect(r.appointments.map((a) => a.id)).toEqual(["a", "b"]);
    expect(r.skipped).toBe(4);
    expect(r.appointments[0]).toMatchObject({ service: "Kylemore", firstName: "Mary" });
  });

  it("reads the shape Microsoft documents for calendarView (start and end, with a trailing Z)", () => {
    const fromDocs: RawAppointment = {
      id: "AAMkADKpAAA=",
      serviceName: "Catered bento",
      customerName: "Jordan Miller",
      customers: [{ name: "Adele Vance" }],
      start: { dateTime: "2018-05-05T12:00:00.0000000Z", timeZone: "UTC" },
      end: { dateTime: "2018-05-05T12:30:00.0000000Z", timeZone: "UTC" },
    };
    const r = normaliseAppointments([fromDocs]);
    expect(r.skipped).toBe(0);
    expect(r.appointments[0]).toMatchObject({ id: "AAMkADKpAAA=", service: "Catered bento", startSec: Date.parse("2018-05-05T12:00:00Z") / 1000, endSec: Date.parse("2018-05-05T12:30:00Z") / 1000, firstName: "Adele" });
  });

  it("copes with the same appointment twice, a missing service and junk entries", () => {
    const r = normaliseAppointments([ok("a", "2026-10-20T10:00:00"), ok("a", "2026-10-20T10:00:00"), ok("c", "2026-10-22T10:00:00", { serviceName: undefined }), null as any, "x" as any]);
    expect(r.appointments.map((a) => a.id)).toEqual(["a", "c"]);
    expect(r.appointments[1].service).toBe("Showroom");
  });
});

describe("shift titles", () => {
  it("names the visit and the first name, nothing more", () => {
    expect(shiftTitle({ service: "Bray", firstName: "Mary" })).toBe("Showroom visit – Bray – Mary");
    expect(shiftTitle({ service: "Bray", firstName: null })).toBe("Showroom visit – Bray");
  });

  it("applies the team's own labels and caps the length", () => {
    expect(shiftTitle({ service: "Sandyford", firstName: "Al" }, { Sandyford: "Home visit" })).toBe("Showroom visit – Home visit – Al");
    expect(shiftTitle({ service: "x".repeat(300), firstName: null }).length).toBeLessThanOrEqual(120);
  });
});

const desired = (id: string, start: number, over: Partial<DesiredShift> = {}): DesiredShift => ({
  bookingId: id,
  service: "Kylemore",
  startSec: start,
  endSec: start + 1800,
  title: "Showroom visit – Kylemore – Mary",
  assignees: [],
  ...over,
});
const link = (d: DesiredShift, over: Partial<ShiftLink> = {}): ShiftLink => ({
  booking_id: d.bookingId,
  shift_id: `s-${d.bookingId}`,
  scheduler_id: 1,
  service: d.service,
  start_at: new Date(d.startSec * 1000).toISOString(),
  end_at: new Date(d.endSec * 1000).toISOString(),
  title: d.title,
  signature: signatureOf(d),
  ...over,
});

describe("planSync", () => {
  const now = 1_800_000_000;
  const day = 86_400;
  const end = now + 90 * day;

  it("creates new bookings, leaves unchanged ones and updates changed ones", () => {
    const a = desired("a", now + day);
    const b = desired("b", now + 2 * day);
    const c = desired("c", now + 3 * day);
    const moved = { ...c, startSec: c.startSec + 3600, endSec: c.endSec + 3600 };
    const plan = planSync([a, b, moved], [link(a), link(c)], now, end);
    expect(plan.create.map((d) => d.bookingId)).toEqual(["b"]);
    expect(plan.update.map((u) => u.desired.bookingId)).toEqual(["c"]);
    expect(plan.unchanged).toBe(1);
    expect(plan.remove).toEqual([]);
  });

  it("keeps the bookings that need nothing, so a preview can still list them", () => {
    const a = desired("a", now + day);
    const b = desired("b", now + 2 * day);
    const plan = planSync([a, b], [link(a), link(b)], now, end);
    expect(plan.unchanged).toBe(2);
    expect(plan.unchangedList.map((d) => d.bookingId)).toEqual(["a", "b"]);
    expect(planSync([a], [], now, end).unchangedList).toEqual([]);
  });

  it("notices a new title or new assignees", () => {
    const a = desired("a", now + day);
    expect(planSync([{ ...a, title: "Showroom visit – Kylemore – Maria" }], [link(a)], now, end).update).toHaveLength(1);
    expect(planSync([{ ...a, assignees: [5] }], [link(a)], now, end).update).toHaveLength(1);
    expect(signatureOf({ ...a, assignees: [2, 1] })).toBe(signatureOf({ ...a, assignees: [1, 2] }));
  });

  it("removes a cancelled future booking but never touches the past", () => {
    const future = desired("future", now + day);
    const past = desired("past", now - 5 * day);
    const keep = desired("keep", now + 2 * day);
    const plan = planSync([keep], [link(future), link(past), link(keep)], now, end);
    expect(plan.remove.map((l) => l.booking_id)).toEqual(["future"]);
  });

  it("ignores bookings that are over or beyond the window", () => {
    const plan = planSync([desired("over", now - 3 * day), desired("far", end + day), desired("ok", now + day)], [], now, end);
    expect(plan.create.map((d) => d.bookingId)).toEqual(["ok"]);
  });

  it("treats an empty answer as a failed read, not as everyone cancelling", () => {
    const links = [1, 2, 3, 4].map((n) => link(desired(`b${n}`, now + n * day)));
    const plan = planSync([], links, now, end);
    expect(plan.remove).toEqual([]);
    expect(plan.held[0]).toMatch(/failed read/);
    // A single appointment with nothing returned is allowed to be a real cancellation.
    expect(planSync([], [link(desired("only", now + day))], now, end).remove).toHaveLength(1);
  });

  it("holds back a large number of removals", () => {
    const keep = desired("keep", now + day);
    const gone = Array.from({ length: PLAN_LIMITS.maxRemovals + 1 }, (_, i) => link(desired(`g${i}`, now + (i + 2) * day)));
    const plan = planSync([keep], [link(keep), ...gone], now, end);
    expect(plan.remove).toEqual([]);
    expect(plan.held[0]).toMatch(/safe limit/);
  });

  it("copies a limited number per run and says so", () => {
    const many = Array.from({ length: PLAN_LIMITS.maxCreates + 5 }, (_, i) => desired(`n${i}`, now + (i + 1) * 60));
    const plan = planSync(many, [], now, end);
    expect(plan.create).toHaveLength(PLAN_LIMITS.maxCreates);
    expect(plan.held[0]).toMatch(/held back/);
  });
});

describe("settings", () => {
  it("is off until the Microsoft details are all present", () => {
    expect(graphConfig({} as any)).toBeNull();
    expect(graphConfig({ MS_GRAPH_TENANT_ID: "t", MS_GRAPH_CLIENT_ID: "c", MS_GRAPH_CLIENT_SECRET: "s" } as any)).toBeNull();
    expect(graphConfig({ MS_GRAPH_TENANT_ID: "t", MS_GRAPH_CLIENT_ID: "c", MS_GRAPH_CLIENT_SECRET: "s", MS_BOOKINGS_BUSINESS_ID: "b" } as any)).toEqual({
      tenantId: "t",
      clientId: "c",
      clientSecret: "s",
      businessId: "b",
    });
  });

  it("ignores spaces, line breaks and quote marks pasted in with a value", () => {
    const cfg = graphConfig({
      MS_GRAPH_TENANT_ID: " tenant\n",
      MS_GRAPH_CLIENT_ID: '"client"',
      MS_GRAPH_CLIENT_SECRET: "'sec~ret'  ",
      MS_BOOKINGS_BUSINESS_ID: "biz@example.com ",
    } as any);
    expect(cfg).toEqual({ tenantId: "tenant", clientId: "client", clientSecret: "sec~ret", businessId: "biz@example.com" });
  });

  it("only writes to Connecteam on an explicit yes", () => {
    expect(bookingsWriteEnabled({} as any)).toBe(false);
    expect(bookingsWriteEnabled({ BOOKINGS_TO_CONNECTEAM_ENABLED: "yes" } as any)).toBe(false);
    expect(bookingsWriteEnabled({ BOOKINGS_TO_CONNECTEAM_ENABLED: " TRUE " } as any)).toBe(true);
  });

  it("reads assignees, labels and the scheduler id carefully", () => {
    expect(appointmentAssignees({ CONNECTEAM_APPOINTMENT_USER_IDS: "12, 34,x,-5, 0" } as any)).toEqual([12, 34]);
    expect(appointmentAssignees({} as any)).toEqual([]);
    expect(serviceLabels({ BOOKINGS_SERVICE_LABELS: '{"Sandyford":"Home visit","bad":5}' } as any)).toEqual({ Sandyford: "Home visit" });
    expect(serviceLabels({ BOOKINGS_SERVICE_LABELS: "not json" } as any)).toEqual({});
    expect(appointmentSchedulerIdFromEnv({ CONNECTEAM_APPOINTMENT_SCHEDULER_ID: "14726654" } as any)).toBe(14726654);
    expect(appointmentSchedulerIdFromEnv({ CONNECTEAM_APPOINTMENT_SCHEDULER_ID: "abc" } as any)).toBeNull();
  });

  it("gives each showroom its own people, matched however Bookings spells the name", () => {
    const env = { BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore": 111, " Bray ": [222, 333], "Bad": "x", "Empty": []}', CONNECTEAM_APPOINTMENT_USER_IDS: "999" } as any;
    expect(serviceAssignees(env)).toEqual({ kylemore: [111], bray: [222, 333] });
    expect(assigneesFor("KYLEMORE", env)).toEqual([111]);
    expect(assigneesFor("bray", env)).toEqual([222, 333]);
    // A showroom with no entry falls back to the general list, then to nobody.
    expect(assigneesFor("Sandyford", env)).toEqual([999]);
    expect(assigneesFor("Sandyford", { BOOKINGS_SERVICE_ASSIGNEES: '{"Bray":1}' } as any)).toEqual([]);
    expect(hasAssignments(env)).toBe(true);
    expect(hasAssignments({ BOOKINGS_SERVICE_ASSIGNEES: '{"Bray":1}' } as any)).toBe(true);
    expect(hasAssignments({} as any)).toBe(false);
  });

  it("ignores an assignment setting it cannot read", () => {
    expect(serviceAssignees({ BOOKINGS_SERVICE_ASSIGNEES: "nonsense" } as any)).toEqual({});
    expect(serviceAssignees({ BOOKINGS_SERVICE_ASSIGNEES: "[1,2]" } as any)).toEqual({});
    expect(serviceAssignees({} as any)).toEqual({});
  });

  it("reads the extra schedules, by id or name", () => {
    expect(extraSchedulerRefs({ CONNECTEAM_EXTRA_SCHEDULERS: " Schedule , 12345678,, " } as any)).toEqual(["Schedule", "12345678"]);
    expect(extraSchedulerRefs({} as any)).toEqual([]);
    expect(extraSchedulerRefs({ CONNECTEAM_EXTRA_SCHEDULERS: "a,b,c,d,e" } as any)).toHaveLength(3);
  });

  it("recognises a shift the copy made, by the ids it recorded or by its title", () => {
    const ids = new Set(["s1"]);
    expect(isBookingCopy({ id: "s1", title: "Anything" }, ids)).toBe(true);
    expect(isBookingCopy({ id: "x", title: "Showroom visit – Bray – Mary" }, new Set())).toBe(true);
    expect(isBookingCopy({ id: "x", title: "  Showroom visit – Kylemore" }, new Set())).toBe(true);
    expect(isBookingCopy({ id: "x", title: "Workshop > Work on doors" }, ids)).toBe(false);
    expect(isBookingCopy({ id: "x" }, ids)).toBe(false);
    expect(isBookingCopy({ id: "x", title: "Kylemore/ Collection > Showroom visit later" }, ids)).toBe(false);
  });

  it("recognises the appointment scheduler by name or by id, and no other", () => {
    expect(isAppointmentScheduler({ schedulerId: 1, name: " Showroom Appointment " }, {} as any)).toBe(true);
    expect(isAppointmentScheduler({ schedulerId: 9, name: "Anything" }, { CONNECTEAM_APPOINTMENT_SCHEDULER_ID: "9" } as any)).toBe(true);
    expect(isAppointmentScheduler({ schedulerId: 2, name: "Schedule" }, {} as any)).toBe(false);
    expect(isAppointmentScheduler({ schedulerId: 3, name: "Sales Schedule" }, {} as any)).toBe(false);
  });
});

describe("Connecteam shift payload", () => {
  it("assigns people when there are some, otherwise creates an open shift", () => {
    expect(shiftPayload({ startSec: 100, endSec: 200, title: "T", assignees: [7] })).toMatchObject({ startTime: 100, endTime: 200, title: "T", isPublished: true, assignedUserIds: [7] });
    const open = shiftPayload({ startSec: 100, endSec: 200, title: "T", assignees: [] });
    expect(open).toMatchObject({ isOpenShift: true, openSpots: 1 });
    expect(open).not.toHaveProperty("assignedUserIds");
  });

  it("keeps an update to the fields Connecteam accepts", () => {
    const body = shiftUpdatePayload("s1", { startSec: 1, endSec: 2, title: "T", assignees: [5], notesHtml: "<p>x</p>" });
    expect(body).toEqual({ shiftId: "s1", startTime: 1, endTime: 2, title: "T", notes: [{ type: "html", html: "<p>x</p>" }], assignedUserIds: [5] });
    // Connecteam answers HTTP 400 to isEditForAllUsers on this call.
    expect(body).not.toHaveProperty("isEditForAllUsers");
    expect(shiftUpdatePayload("s1", { startSec: 1, endSec: 2, title: "T", assignees: [] })).toEqual({ shiftId: "s1", startTime: 1, endTime: 2, title: "T" });
  });

  it("names the shift \"shiftId\" on an update, as Connecteam requires, and never \"id\"", () => {
    const body = shiftUpdatePayload("s1", { startSec: 1, endSec: 2, title: "T", assignees: [5], notesHtml: "<p>x</p>" });
    expect(body.shiftId).toBe("s1");
    expect(body).not.toHaveProperty("id");
  });

  it("only trusts a create that names the shift it made", () => {
    expect(createdShiftId({ data: { shifts: [{ id: "abc" }] } })).toBe("abc");
    expect(createdShiftId({ data: { shifts: [{ id: 42 }] } })).toBe("42");
    expect(createdShiftId({ data: { shifts: [] } })).toBeNull();
    expect(createdShiftId({})).toBeNull();
    expect(createdShiftId(null)).toBeNull();
  });
});

describe("Microsoft Graph reading", () => {
  const cfg = { tenantId: "tenant", clientId: "client", clientSecret: "SECRET-VALUE", businessId: "Bookings@example.com" };

  beforeEach(() => resetGraphTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  it("signs in once, follows paging, and asks only for the window it needs", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        if (!url.includes("page2")) return new Response(JSON.stringify({ value: [{ id: "a" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next?page2" }));
        expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
        return new Response(JSON.stringify({ value: [{ id: "b" }] }));
      })
    );
    const rows = await fetchBookingAppointments(cfg, "2026-10-14T00:00:00.000Z", "2027-01-12T00:00:00.000Z");
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(calls[1]).toContain("/solutions/bookingBusinesses/Bookings%40example.com/calendarView?start=2026-10-14");
    expect(calls.filter((u) => u.includes("login.microsoftonline.com"))).toHaveLength(1);
  });

  it("says which part of the sign-in is wrong, using Microsoft's code, without repeating anything it sent", async () => {
    const reply = (code: number) =>
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client", error_codes: [code], error_description: "AADSTS secret=SECRET-VALUE trace 123" }), { status: 401 })));

    reply(7000215);
    let err = (await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/HTTP 401, AADSTS7000215\)\. The client secret is wrong\. Use the secret's Value \(not its Secret ID\)/);
    expect(err.message).not.toMatch(/SECRET-VALUE|trace/);

    reply(7000222);
    err = (await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/has expired/);

    reply(700016);
    err = (await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/client id was not found/);

    reply(90002);
    err = (await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/tenant id was not found/);

    reply(123456);
    err = (await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/AADSTS123456\)\. Check the tenant id, client id and secret/);
  });

  it("reads the permissions a token carries, and nothing else from it", () => {
    const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
    expect(tokenRoles(jwt({ roles: ["Bookings.Read.All", "User.Read.All"], sub: "secret-subject" }))).toEqual(["Bookings.Read.All", "User.Read.All"]);
    expect(tokenRoles(jwt({ aud: "graph" }))).toEqual([]);
    expect(tokenRoles("not-a-token")).toBeNull();
  });

  it("explains a Bookings refusal by showing what the app's sign-in actually carries", async () => {
    const jwt = (roles: string[]) => `h.${Buffer.from(JSON.stringify({ roles })).toString("base64url")}.s`;
    const run = async (roles: string[], status: number) => {
      resetGraphTokenCache();
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) =>
          url.includes("login.microsoftonline.com")
            ? new Response(JSON.stringify({ access_token: jwt(roles), expires_in: 3600 }))
            : new Response(JSON.stringify({ error: { code: "Unauthorized", message: "token abc-123" } }), { status })
        )
      );
      return ((await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error).message;
    };

    const none = await run([], 401);
    expect(none).toMatch(/HTTP 401 \(Unauthorized\)/);
    expect(none).toMatch(/no application permissions at all.*Delegated/);
    expect(none).not.toContain("abc-123");

    expect(await run(["User.Read.All"], 403)).toMatch(/no Bookings one: User\.Read\.All/);
    expect(await run(["Bookings.Read.All"], 401)).toMatch(/does carry Bookings\.Read\.All, so the permission is in place/);
    // Other failures do not get a permission explanation.
    expect(await run(["Bookings.Read.All"], 404)).not.toMatch(/carry/);
  });

  it("recovers by itself when a token was minted before the permission was granted", async () => {
    const jwt = (roles: string[]) => `h.${Buffer.from(JSON.stringify({ roles })).toString("base64url")}.s`;
    let logins = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("login.microsoftonline.com")) {
          logins += 1;
          return new Response(JSON.stringify({ access_token: logins === 1 ? jwt([]) : jwt(["Bookings.Read.All"]), expires_in: 3600 }));
        }
        const auth = (init?.headers as Record<string, string>).Authorization;
        return auth.includes(jwt(["Bookings.Read.All"])) ? new Response(JSON.stringify({ value: [{ id: "a" }] })) : new Response("{}", { status: 401 });
      })
    );
    const rows = await fetchBookingAppointments(cfg, "a", "b");
    expect(rows.map((r) => r.id)).toEqual(["a"]);
    expect(logins).toBe(2);
  });

  it("retries a refusal only once, then explains it", async () => {
    let logins = 0;
    let graphCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("login.microsoftonline.com")) {
          logins += 1;
          return new Response(JSON.stringify({ access_token: `h.${Buffer.from(JSON.stringify({ roles: [] })).toString("base64url")}.s`, expires_in: 3600 }));
        }
        graphCalls += 1;
        return new Response("{}", { status: 401 });
      })
    );
    const err = (await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/no application permissions at all/);
    expect(logins).toBe(2);
    expect(graphCalls).toBe(2);
  });

  it("never follows a paging link to another site", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("login.microsoftonline.com")
          ? new Response(JSON.stringify({ access_token: "tok" }))
          : new Response(JSON.stringify({ value: [], "@odata.nextLink": "https://evil.example.com/steal" }))
      )
    );
    await expect(fetchBookingAppointments(cfg, "a", "b")).rejects.toThrow(/unexpected paging link/);
  });

  it("explains failures without ever repeating the secret", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied SECRET-VALUE", { status: 401 })));
    const err = (await fetchBookingAppointments(cfg, "a", "b").catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/Microsoft sign-in failed \(HTTP 401\)/);
    expect(err.message).not.toContain("SECRET-VALUE");

    resetGraphTokenCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => (url.includes("login.microsoftonline.com") ? new Response(JSON.stringify({ access_token: "tok" })) : new Response("no", { status: 403 })))
    );
    await expect(fetchBookingAppointments(cfg, "a", "b")).rejects.toThrow(/permission or admin consent/);
  });
});

describe("customer details for the shift notes", () => {
  it("takes name, phone and note from the first customer, falling back to the top-level fields", () => {
    expect(customerDetails({ customers: [{ name: "Sarah Byrne", phone: "087 123 4567", notes: "Oak doors, 12 of them" }], customerName: "Someone Else" })).toEqual({
      name: "Sarah Byrne",
      phone: "087 123 4567",
      note: "Oak doors, 12 of them",
    });
    expect(customerDetails({ customerName: "Tom Ryan", customerPhone: "01 555 0100", customerNotes: "Ring first" })).toEqual({ name: "Tom Ryan", phone: "01 555 0100", note: "Ring first" });
    expect(customerDetails({})).toEqual({ name: null, phone: null, note: null });
    expect(customerDetails({ customers: [{ name: "  ", phone: "", notes: null }] })).toEqual({ name: null, phone: null, note: null });
  });

  it("keeps a phone number to digits and ordinary punctuation, and limits every field's length", () => {
    expect(customerDetails({ customerPhone: "+353 (87) 123-4567 ext <b>9</b>" }).phone).toBe("+353 (87) 123-4567 9");
    const long = customerDetails({ customerName: "x".repeat(500), customerNotes: "y".repeat(2000), customerPhone: "1".repeat(200) });
    expect(long.name?.length).toBe(120);
    expect(long.note?.length).toBe(600);
    expect(long.phone?.length).toBe(40);
  });

  it("writes the notes as escaped HTML, so a customer cannot add markup or links", () => {
    const html = notesHtml({ name: 'Sarah <script>alert(1)</script> "Byrne"', phone: "087 123 4567", note: "Line one\nLine <b>two</b> & more" }) as string;
    expect(html).toContain("<strong>Customer:</strong> Sarah &lt;script&gt;alert(1)&lt;/script&gt; &quot;Byrne&quot;");
    expect(html).toContain("<strong>Phone:</strong> 087 123 4567");
    expect(html).toContain("Line one<br>Line &lt;b&gt;two&lt;/b&gt; &amp; more");
    expect(html).not.toMatch(/<script|<b>two/);
    expect(escapeHtml("a&b<c>'d'")).toBe("a&amp;b&lt;c&gt;&#39;d&#39;");
  });

  it("leaves out whatever is missing, and makes no note at all when there is nothing", () => {
    expect(notesHtml({ name: "Sarah Byrne", phone: null, note: null })).toBe("<p><strong>Customer:</strong> Sarah Byrne</p>");
    expect(notesHtml({ name: null, phone: "087 1", note: null })).toBe("<p><strong>Phone:</strong> 087 1</p>");
    expect(notesHtml({ name: null, phone: null, note: null })).toBeUndefined();
  });

  it("rides along on a normalised appointment", () => {
    const r = normaliseAppointments([
      { id: "a", serviceName: "Kylemore", start: { dateTime: "2026-10-20T12:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-20T12:30:00", timeZone: "UTC" }, customers: [{ name: "Sarah Byrne", phone: "087 123 4567", notes: "Hi" }] },
    ]);
    expect(r.appointments[0].details).toEqual({ name: "Sarah Byrne", phone: "087 123 4567", note: "Hi" });
    expect(r.appointments[0].firstName).toBe("Sarah");
  });

  it("puts the notes in the Connecteam request in its note format, and only when there are some", () => {
    const withNotes = shiftPayload({ startSec: 1, endSec: 2, title: "T", assignees: [5], notesHtml: "<p>x</p>" });
    expect(withNotes.notes).toEqual([{ type: "html", html: "<p>x</p>" }]);
    expect(shiftPayload({ startSec: 1, endSec: 2, title: "T", assignees: [5] })).not.toHaveProperty("notes");
    expect(shiftUpdatePayload("s1", { startSec: 1, endSec: 2, title: "T", assignees: [5], notesHtml: "<p>x</p>" }).notes).toEqual([{ type: "html", html: "<p>x</p>" }]);
  });

  it("notices a change in the notes without ever storing their text", () => {
    const base = { startSec: 1, endSec: 2, title: "T", assignees: [5] };
    const a = signatureOf({ ...base, notes: "<p>Phone: 087 123 4567</p>" });
    expect(a).not.toMatch(/087|Phone/);
    expect(signatureOf({ ...base, notes: "<p>Phone: 087 123 4567</p>" })).toBe(a);
    expect(signatureOf({ ...base, notes: "<p>Phone: 087 999 9999</p>" })).not.toBe(a);
    expect(signatureOf(base)).not.toBe(a);
    expect(signatureOf(base)).toBe(signatureOf({ ...base, notes: undefined }));
  });
});
