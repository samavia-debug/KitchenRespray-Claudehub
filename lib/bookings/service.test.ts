import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- A small in-memory stand-in for the database ----
type Row = Record<string, any>;
const db: { links: Row[]; state: Row; failInsert: boolean; failInsertFor: number | null; staff: Row[] } = { links: [], state: {}, failInsert: false, failInsertFor: null, staff: [] };

function exec(q: any): { data?: any; error: { message: string } | null; count?: number } {
  const matches = (row: Row) => q.filters.every((f: any[]) => row[f[0]] === f[1]);
  if (q.table === "booking_shift_links") {
    if (q.op === "select") return q.head ? { error: null, count: db.links.length } : { data: db.links.map((r) => ({ ...r })), error: null };
    if (q.op === "insert") {
      if (db.failInsert || (db.failInsertFor !== null && q.payload.scheduler_id === db.failInsertFor)) return { error: { message: "insert refused" } };
      // The key is the booking AND the schedule it was copied into.
      if (db.links.some((r) => r.booking_id === q.payload.booking_id && r.scheduler_id === q.payload.scheduler_id)) return { error: { message: "duplicate key" } };
      db.links.push({ ...q.payload });
      return { error: null };
    }
    if (q.op === "update") {
      db.links.filter(matches).forEach((row) => Object.assign(row, q.payload));
      return { error: null };
    }
    if (q.op === "delete") {
      db.links = db.links.filter((r) => !matches(r));
      return { error: null };
    }
  }
  if (q.table === "knowledge_entries") return { data: db.staff.map((r) => ({ ...r })), error: null };
  if (q.table === "booking_sync_state") {
    if (q.op === "update" && q.orStr) {
      const running = db.state.running_since ? Date.parse(db.state.running_since) : 0;
      if (!db.state.running_since || running < Date.now() - 10 * 60_000) {
        Object.assign(db.state, q.payload);
        return { data: [{ id: 1 }], error: null };
      }
      return { data: [], error: null };
    }
    if (q.op === "update") {
      Object.assign(db.state, q.payload);
      return { error: null };
    }
    return { data: db.state, error: null };
  }
  return { data: [], error: null };
}

function from(table: string) {
  const q: any = { table, op: "select", filters: [] };
  const api: any = {
    select(_c?: string, opts?: any) {
      q.head = opts?.head;
      return api;
    },
    insert(p: any) {
      q.op = "insert";
      q.payload = p;
      return api;
    },
    update(p: any) {
      q.op = "update";
      q.payload = p;
      return api;
    },
    delete() {
      q.op = "delete";
      return api;
    },
    eq(c: string, v: any) {
      q.filters.push([c, v]);
      return api;
    },
    or(s: string) {
      q.orStr = s;
      return api;
    },
    maybeSingle() {
      return api;
    },
    then(res: any, rej: any) {
      return Promise.resolve(exec(q)).then(res, rej);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => ({ from }) }));

import { bookingsRanRecently, runBookingsSync } from "./service";
import { resetGraphTokenCache } from "./graph";

// ---- Fake Microsoft and Connecteam ----
type Appt = Record<string, any>;
const world: { appts: Appt[]; schedulers: any[]; calls: { method: string; url: string; body?: any }[]; nextId: number; createStatus: number; deleteStatus: number } = {
  appts: [],
  schedulers: [],
  calls: [],
  nextId: 1,
  createStatus: 200,
  deleteStatus: 200,
};

const stamp = (daysAhead: number, hour = 10) => {
  const d = new Date(Date.now() + daysAhead * 86_400_000);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};
const gdt = (d: Date) => ({ dateTime: d.toISOString().slice(0, 19) + ".0000000", timeZone: "UTC" });
const appt = (id: string, daysAhead: number, name = "Mary O'Brien", service = "Kylemore", phone?: string, note?: string): Appt => {
  const start = stamp(daysAhead);
  return { id, serviceName: service, start: gdt(start), end: gdt(new Date(start.getTime() + 1_800_000)), customers: [{ name, phone, notes: note }] };
};

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body && typeof init.body === "string" && init.body.startsWith("[") ? JSON.parse(init.body) : undefined;
      world.calls.push({ method, url, body });
      if (url.includes("login.microsoftonline.com")) return new Response(JSON.stringify({ access_token: "tok", expires_in: 3600 }));
      if (url.includes("graph.microsoft.com")) return new Response(JSON.stringify({ value: world.appts }));
      if (url.endsWith("/scheduler/v1/schedulers")) return new Response(JSON.stringify({ data: { schedulers: world.schedulers } }));
      if (method === "POST" && url.includes("/shifts")) {
        if (world.createStatus !== 200) return new Response("nope", { status: world.createStatus });
        return new Response(JSON.stringify({ data: { shifts: [{ id: `shift-${world.nextId++}` }] } }));
      }
      if (method === "PUT" && url.includes("/shifts")) return new Response(JSON.stringify({}));
      if (method === "DELETE") return world.deleteStatus === 200 ? new Response("") : new Response("gone", { status: world.deleteStatus });
      return new Response("unexpected", { status: 500 });
    })
  );
}

const posts = () => world.calls.filter((c) => c.method === "POST" && c.url.includes("/shifts"));
const puts = () => world.calls.filter((c) => c.method === "PUT");
const deletes = () => world.calls.filter((c) => c.method === "DELETE");

const ENV = {
  MS_GRAPH_TENANT_ID: "tenant",
  MS_GRAPH_CLIENT_ID: "client",
  MS_GRAPH_CLIENT_SECRET: "secret",
  MS_BOOKINGS_BUSINESS_ID: "biz@example.com",
  CONNECTEAM_API_KEY: "key",
  BOOKINGS_TO_CONNECTEAM_ENABLED: "true",
};

function setEnv(over: Record<string, string | undefined> = {}) {
  for (const k of Object.keys(ENV)) delete process.env[k];
  delete process.env.CONNECTEAM_APPOINTMENT_USER_IDS;
  delete process.env.BOOKINGS_SERVICE_ASSIGNEES;
  delete process.env.CONNECTEAM_EXTRA_SCHEDULERS;
  delete process.env.CONNECTEAM_APPOINTMENT_SCHEDULER_ID;
  delete process.env.BOOKINGS_SERVICE_LABELS;
  for (const [k, v] of Object.entries({ ...ENV, ...over })) if (v !== undefined) process.env[k] = v;
}

beforeEach(() => {
  db.links = [];
  db.state = { id: 1, running_since: null, last_run_at: null, last_result: null };
  db.failInsert = false;
  db.failInsertFor = null;
  db.staff = [];
  world.appts = [];
  world.schedulers = [{ schedulerId: 55, name: "Showroom Appointment" }, { schedulerId: 1, name: "Schedule" }];
  world.calls = [];
  world.nextId = 1;
  world.createStatus = 200;
  world.deleteStatus = 200;
  resetGraphTokenCache();
  setEnv();
  installFetch();
});
afterEach(() => vi.unstubAllGlobals());

describe("switched off by default", () => {
  it("does nothing, and contacts nobody, until the Microsoft details exist", async () => {
    setEnv({ MS_GRAPH_CLIENT_SECRET: undefined });
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("not_configured");
    expect(world.calls).toEqual([]);
    expect(db.links).toEqual([]);
  });

  it("needs Connecteam to be connected too", async () => {
    setEnv({ CONNECTEAM_API_KEY: undefined });
    expect((await runBookingsSync({ apply: true })).state).toBe("not_configured");
    expect(world.calls).toEqual([]);
  });

  it("only previews, changing nothing, when asked to preview", async () => {
    world.appts = [appt("a", 2)];
    const r = await runBookingsSync({ apply: false });
    expect(r.state).toBe("preview");
    expect(r.counts).toMatchObject({ create: 1, update: 0, remove: 0 });
    expect(r.items?.[0]).toMatchObject({ action: "create", service: "Kylemore", firstName: "Mary" });
    expect(posts()).toHaveLength(0);
    expect(db.links).toEqual([]);
  });

  it("only previews when writing to Connecteam has not been switched on, even if asked to copy", async () => {
    setEnv({ BOOKINGS_TO_CONNECTEAM_ENABLED: undefined });
    world.appts = [appt("a", 2)];
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("preview");
    expect(r.message).toMatch(/switched off/);
    expect(posts()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
    expect(db.links).toEqual([]);
  });
});

describe("copying bookings", () => {
  it("creates an open shift in the Showroom Appointment scheduler, with a first name only, and records the link", async () => {
    world.appts = [appt("a", 2, "Mary O'Brien")];
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("applied");
    expect(r.errors).toEqual([]);
    expect(posts()).toHaveLength(1);
    expect(posts()[0].url).toContain("/schedulers/55/shifts"); // not the "Schedule" scheduler
    const sent = posts()[0].body[0];
    expect(sent.title).toBe("Showroom visit – Kylemore – Mary");
    expect(sent).toMatchObject({ isPublished: true, isOpenShift: true, openSpots: 1 });
    expect(JSON.stringify(sent)).not.toMatch(/O'Brien|@/); // no surname or contact details
    expect(db.links).toHaveLength(1);
    expect(db.links[0]).toMatchObject({ booking_id: "a", shift_id: "shift-1", scheduler_id: 55 });
    expect(db.state.running_since).toBeNull(); // lock released
  });

  it("assigns the people it is told to", async () => {
    setEnv({ CONNECTEAM_APPOINTMENT_USER_IDS: "11,22" });
    world.appts = [appt("a", 2)];
    await runBookingsSync({ apply: true });
    expect(posts()[0].body[0].assignedUserIds).toEqual([11, 22]);
    expect(posts()[0].body[0]).not.toHaveProperty("isOpenShift");
  });

  it("puts each showroom's bookings under its own person, leaving others open", async () => {
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111,"Bray":222}' });
    world.appts = [appt("k", 2, "Sarah Byrne", "KYLEMORE"), appt("b", 3, "Tom Ryan", "Bray"), appt("s", 4, "Olivia Doyle", "Sandyford")];
    const r = await runBookingsSync({ apply: true });
    expect(r.errors).toEqual([]);
    const byTitle = (needle: string) => posts().map((p) => p.body[0]).find((b: any) => b.title.includes(needle));
    expect(byTitle("Sarah").assignedUserIds).toEqual([111]);
    expect(byTitle("Tom").assignedUserIds).toEqual([222]);
    expect(byTitle("Olivia")).toMatchObject({ isOpenShift: true });
    expect(byTitle("Olivia")).not.toHaveProperty("assignedUserIds");
  });

  it("moves existing shifts to the right person when the assignment changes", async () => {
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore")];
    await runBookingsSync({ apply: true }); // copied as an open shift
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}' });
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(r.counts).toMatchObject({ create: 0, update: 1 });
    expect(puts()[0].body[0]).toMatchObject({ shiftId: "shift-1", assignedUserIds: [111] });
  });

  it("always lists every upcoming booking in a preview, even when nothing needs changing", async () => {
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}' });
    db.staff = [{ title: "S Erin Kennedy", status: "verified", external_id: "111" }];
    world.appts = [appt("a", 3, "Sarah Byrne", "Kylemore"), appt("b", 2, "Olivia Doyle", "Sandyford")];
    await runBookingsSync({ apply: true });

    world.calls = [];
    const r = await runBookingsSync({ apply: false });
    expect(r.counts).toMatchObject({ create: 0, update: 0, remove: 0, unchanged: 2 });
    expect(r.items).toHaveLength(2);
    // Earliest first, each with its showroom, first name and who it belongs to.
    expect(r.items?.map((i) => [i.action, i.service, i.firstName, i.assignedTo])).toEqual([
      ["unchanged", "Sandyford", "Olivia", "Open shift"],
      ["unchanged", "Kylemore", "Sarah", "Erin Kennedy"],
    ]);
    expect(posts()).toHaveLength(0);
    expect(puts()).toHaveLength(0);
  });

  it("falls back to the person's id when the staff list cannot name them", async () => {
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}' });
    world.appts = [appt("a", 2, "Sarah Byrne", "Kylemore")];
    const r = await runBookingsSync({ apply: false });
    expect(r.items?.[0].assignedTo).toBe("Connecteam user 111");
  });

  it("copies nothing twice", async () => {
    world.appts = [appt("a", 2), appt("b", 3, "Tom Byrne", "Bray")];
    await runBookingsSync({ apply: true });
    world.calls = [];
    const again = await runBookingsSync({ apply: true });
    expect(again.counts).toMatchObject({ create: 0, update: 0, remove: 0, unchanged: 2 });
    expect(posts()).toHaveLength(0);
    expect(puts()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
    expect(db.links).toHaveLength(2);
  });

  it("moves a rescheduled booking's shift", async () => {
    world.appts = [appt("a", 2)];
    await runBookingsSync({ apply: true });
    world.appts = [appt("a", 4)];
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(r.counts).toMatchObject({ create: 0, update: 1, remove: 0 });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).toContain("/schedulers/55/shifts");
    expect(puts()[0].body[0]).toMatchObject({ shiftId: "shift-1" });
    expect(Date.parse(db.links[0].start_at) / 1000).toBe(Math.floor(stamp(4).getTime() / 1000));
  });

  it("pings the person only when the time moves, and makes a notes-only change quietly", async () => {
    world.appts = [appt("a", 2, "Sarah Byrne", "Kylemore", "087 123 4567", "First")];
    await runBookingsSync({ apply: true });

    // Only the note changes: a silent update.
    world.appts = [appt("a", 2, "Sarah Byrne", "Kylemore", "087 123 4567", "Second")];
    world.calls = [];
    await runBookingsSync({ apply: true });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).toContain("notifyUsers=false");

    // The appointment moves: the person is told.
    world.appts = [appt("a", 4, "Sarah Byrne", "Kylemore", "087 123 4567", "Second")];
    world.calls = [];
    await runBookingsSync({ apply: true });
    expect(puts()).toHaveLength(1);
    expect(puts()[0].url).not.toContain("notifyUsers");
  });

  it("removes the shift of a cancelled booking", async () => {
    world.appts = [appt("a", 2), appt("b", 3)];
    await runBookingsSync({ apply: true });
    world.appts = [appt("a", 2)];
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(r.counts).toMatchObject({ remove: 1 });
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].url).toContain("/schedulers/55/shifts/shift-2");
    expect(db.links.map((l) => l.booking_id)).toEqual(["a"]);
  });

  it("still forgets a booking whose shift was already deleted in Connecteam", async () => {
    world.appts = [appt("a", 2), appt("b", 3)];
    await runBookingsSync({ apply: true });
    world.appts = [appt("a", 2)];
    world.deleteStatus = 404;
    const r = await runBookingsSync({ apply: true });
    expect(r.errors).toEqual([]);
    expect(db.links.map((l) => l.booking_id)).toEqual(["a"]);
  });

  it("will not wipe the calendar because Microsoft returned nothing", async () => {
    world.appts = [appt("a", 2), appt("b", 3), appt("c", 4)];
    await runBookingsSync({ apply: true });
    world.appts = [];
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(deletes()).toHaveLength(0);
    expect(r.held[0]).toMatch(/failed read/);
    expect(db.links).toHaveLength(3);
  });
});

describe("when something goes wrong", () => {
  it("takes a new shift back out if its link cannot be recorded, so it is not copied twice", async () => {
    world.appts = [appt("a", 2)];
    db.failInsert = true;
    const r = await runBookingsSync({ apply: true });
    expect(r.errors[0]).toMatch(/could not record the link/);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].url).toContain("shift-1");
    expect(db.links).toEqual([]);
  });

  it("carries on with the others when one create is rejected, and says which failed", async () => {
    world.appts = [appt("a", 2)];
    world.createStatus = 400;
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("applied");
    expect(r.errors[0]).toMatch(/Create failed: Connecteam API returned HTTP 400/);
    expect(db.links).toEqual([]);
    expect(db.state.running_since).toBeNull();
  });

  it("refuses to run twice at once", async () => {
    db.state.running_since = new Date().toISOString();
    world.appts = [appt("a", 2)];
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("busy");
    expect(world.calls).toEqual([]);
  });

  it("takes over a lock left behind by a run that died", async () => {
    db.state.running_since = new Date(Date.now() - 30 * 60_000).toISOString();
    world.appts = [appt("a", 2)];
    expect((await runBookingsSync({ apply: true })).state).toBe("applied");
  });

  it("explains a missing scheduler instead of guessing one", async () => {
    world.schedulers = [{ schedulerId: 1, name: "Schedule" }];
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("error");
    expect(r.message).toMatch(/No Connecteam scheduler called "Showroom Appointment"/);
    expect(posts()).toHaveLength(0);
  });

  it("reports a Microsoft failure without copying anything", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("login.")
          ? new Response("no", { status: 401 })
          : url.endsWith("/scheduler/v1/schedulers")
          ? new Response(JSON.stringify({ data: { schedulers: world.schedulers } }))
          : new Response("{}")
      )
    );
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("error");
    expect(r.message).toMatch(/Microsoft sign-in failed/);
    expect(db.links).toEqual([]);
  });

  it("counts appointments it could not read instead of copying them at a guessed time", async () => {
    world.appts = [{ id: "x", serviceName: "Bray", startDateTime: { dateTime: "2026-10-20T10:00:00", timeZone: "Mars" }, endDateTime: { dateTime: "2026-10-20T10:30:00", timeZone: "Mars" } }];
    const r = await runBookingsSync({ apply: false });
    expect(r.skippedAppointments).toBe(1);
    expect(r.counts?.create).toBe(0);
  });
});
const SCHED_RE = /schedulers\/(\d+)\//;

describe("copying into the main Schedule as well", () => {
  const toSchedule = () => posts().filter((p) => p.url.includes("/schedulers/1/"));
  const toShowroom = () => posts().filter((p) => p.url.includes("/schedulers/55/"));
  const assign = { BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}', CONNECTEAM_EXTRA_SCHEDULERS: "Schedule" };

  async function twoBookings() {
    setEnv(assign);
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore"), appt("s", 3, "Olivia Doyle", "Sandyford")];
    return runBookingsSync({ apply: true });
  }

  it("copies an assigned appointment into both schedules, but never an open one into the main one", async () => {
    const r = await twoBookings();
    expect(r.errors).toEqual([]);
    expect(toShowroom()).toHaveLength(2); // Showroom Appointment takes everything
    expect(toSchedule()).toHaveLength(1); // the main Schedule only the assigned one
    expect(toSchedule()[0].body[0]).toMatchObject({ assignedUserIds: [111] });
    expect(toSchedule()[0].body[0]).not.toHaveProperty("isOpenShift"); // nobody on the main schedule can claim it
    expect(db.links.map((l) => [l.booking_id, l.scheduler_id]).sort()).toEqual([["k", 1], ["k", 55], ["s", 55]]);
    expect(r.extras).toEqual([{ schedulerId: 1, name: "Schedule", counts: { create: 1, update: 0, remove: 0, unchanged: 0, done: 1 }, skippedOpen: 1 }]);
    expect(r.counts).toMatchObject({ create: 2, done: 2 });
  });

  it("copies nothing twice into either", async () => {
    await twoBookings();
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(posts()).toHaveLength(0);
    expect(puts()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
    expect(r.counts).toMatchObject({ create: 0, unchanged: 2 });
    expect(r.extras?.[0].counts).toMatchObject({ create: 0, unchanged: 1 });
  });

  it("removes a cancelled booking from both schedules", async () => {
    await twoBookings();
    world.appts = [appt("s", 3, "Olivia Doyle", "Sandyford")];
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(r.errors).toEqual([]);
    expect(deletes().map((d) => d.url.match(SCHED_RE)?.[1]).sort()).toEqual(["1", "55"]);
    expect(db.links.map((l) => l.booking_id)).toEqual(["s"]);
  });

  it("adds an appointment to the main schedule once someone is assigned to it", async () => {
    setEnv({ CONNECTEAM_EXTRA_SCHEDULERS: "Schedule" });
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore")];
    await runBookingsSync({ apply: true }); // open shift: only in the showroom schedule
    expect(toSchedule()).toHaveLength(0);

    setEnv({ ...assign });
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(toSchedule()).toHaveLength(1);
    expect(puts()).toHaveLength(1); // the showroom copy moves from open to assigned
    expect(r.extras?.[0].counts).toMatchObject({ create: 1, done: 1 });
  });

  it("finds an extra schedule by its id too", async () => {
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}', CONNECTEAM_EXTRA_SCHEDULERS: "1" });
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore")];
    await runBookingsSync({ apply: true });
    expect(toSchedule()).toHaveLength(1);
  });

  it("stops before writing anything when an extra schedule cannot be found", async () => {
    setEnv({ CONNECTEAM_EXTRA_SCHEDULERS: "No Such Schedule" });
    world.appts = [appt("k", 2)];
    const r = await runBookingsSync({ apply: true });
    expect(r.state).toBe("error");
    expect(r.message).toMatch(/CONNECTEAM_EXTRA_SCHEDULERS names "No Such Schedule"/);
    expect(posts()).toHaveLength(0);
    expect(db.links).toEqual([]);
  });

  it("only previews, with the extra schedule's counts, when asked to preview", async () => {
    setEnv(assign);
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore"), appt("s", 3, "Olivia Doyle", "Sandyford")];
    const r = await runBookingsSync({ apply: false });
    expect(r.state).toBe("preview");
    expect(r.counts).toMatchObject({ create: 2 });
    expect(r.extras?.[0]).toMatchObject({ name: "Schedule", counts: { create: 1 }, skippedOpen: 1 });
    expect(posts()).toHaveLength(0);
  });

  it("takes back only the copy it cannot record, and keeps the other schedule's good one", async () => {
    setEnv(assign);
    db.failInsertFor = 1;
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore")];
    const r = await runBookingsSync({ apply: true });
    expect(r.errors[0]).toMatch(/^Schedule: Create failed: could not record the link/);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].url).toContain("/schedulers/1/");
    expect(db.links.map((l) => l.scheduler_id)).toEqual([55]);
  });

  it("counts a booking once in the preview even though it sits in two schedules", async () => {
    await twoBookings();
    const r = await runBookingsSync({ apply: false });
    expect(r.counts?.unchanged).toBe(2);
    expect(r.items).toHaveLength(2);
  });
});

describe("customer details in the shifts", () => {
  const bodyOf = (call: { body?: any }) => call.body[0];

  it("puts the name, phone and note in the notes of every copy, and none of it in our own records", async () => {
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}', CONNECTEAM_EXTRA_SCHEDULERS: "Schedule" });
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore", "087 123 4567", "Oak doors <12>")];
    const r = await runBookingsSync({ apply: true });
    expect(r.errors).toEqual([]);
    expect(posts()).toHaveLength(2); // Showroom Appointment and the main Schedule
    for (const p of posts()) {
      const b = bodyOf(p);
      expect(b.title).toBe("Showroom visit – Kylemore – Sarah"); // the title still carries only the first name
      expect(b.notes).toHaveLength(1);
      expect(b.notes[0].type).toBe("html");
      expect(b.notes[0].html).toContain("<strong>Customer:</strong> Sarah Byrne");
      expect(b.notes[0].html).toContain("<strong>Phone:</strong> 087 123 4567");
      expect(b.notes[0].html).toContain("Oak doors &lt;12&gt;");
    }
    // Nothing about the customer is kept in the link records: only a fingerprint.
    expect(JSON.stringify(db.links)).not.toMatch(/087 123|Byrne|Oak doors/);
    expect(JSON.stringify(db.state)).not.toMatch(/087 123|Byrne|Oak doors/);
    // The only place the details appear in a result is the page's own item list; the rest of it (what is logged
    // and stored, and what the scheduled ticks send back) carries none.
    const { items, ...summary } = r;
    expect(items?.[0].details?.phone).toBe("087 123 4567");
    expect(JSON.stringify(summary)).not.toMatch(/087 123|Byrne|Oak doors/);
  });

  it("updates the shifts when the customer changes their note, and not otherwise", async () => {
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}', CONNECTEAM_EXTRA_SCHEDULERS: "Schedule" });
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore", "087 123 4567", "First note")];
    await runBookingsSync({ apply: true });

    world.calls = [];
    expect((await runBookingsSync({ apply: true })).counts).toMatchObject({ update: 0, unchanged: 1 });
    expect(puts()).toHaveLength(0);

    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore", "087 123 4567", "Second note")];
    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(r.counts).toMatchObject({ update: 1 });
    expect(puts()).toHaveLength(2);
    for (const p of puts()) expect(bodyOf(p).notes[0].html).toContain("Second note");
  });

  it("brings shifts copied before this existed up to date once, adding the details", async () => {
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore", "087 123 4567", "Hello")];
    await runBookingsSync({ apply: true });
    // As the record looked before notes were part of it: the same signature without the trailing notes field.
    db.links.forEach((l) => (l.signature = l.signature.replace(/\|[0-9a-f]{12}$/, "|")));

    world.calls = [];
    const r = await runBookingsSync({ apply: true });
    expect(r.counts).toMatchObject({ update: 1, unchanged: 0 });
    expect(bodyOf(puts()[0]).notes[0].html).toContain("087 123 4567");

    world.calls = [];
    expect((await runBookingsSync({ apply: true })).counts).toMatchObject({ update: 0, unchanged: 1 });
    expect(puts()).toHaveLength(0);
  });

  it("shows the details to the Admin page in a preview, but never stores or schedules them", async () => {
    setEnv({ BOOKINGS_SERVICE_ASSIGNEES: '{"Kylemore":111}' });
    world.appts = [appt("k", 2, "Sarah Byrne", "Kylemore", "087 123 4567", "Oak doors")];
    await runBookingsSync({ apply: true });

    const r = await runBookingsSync({ apply: false });
    expect(r.items?.[0].details).toEqual({ name: "Sarah Byrne", phone: "087 123 4567", note: "Oak doors" });
    // What is kept for the next run is the summary only, without the list or any customer details.
    expect(JSON.stringify(db.state)).not.toMatch(/087 123|Byrne|Oak doors|items/);
    // A removal has no details to show.
    world.appts = [];
    const gone = await runBookingsSync({ apply: false });
    expect(gone.items?.every((i) => i.details === null || i.action !== "remove")).toBe(true);
  });

  it("makes no notes when Bookings has no details", async () => {
    world.appts = [{ id: "x", serviceName: "Bray", start: gdt(stamp(2)), end: gdt(new Date(stamp(2).getTime() + 1_800_000)) }];
    await runBookingsSync({ apply: true });
    expect(bodyOf(posts()[0])).not.toHaveProperty("notes");
  });
});

describe("telling whether the copy ran a moment ago", () => {
  it("is true for a run within the window and false otherwise", async () => {
    db.state.last_run_at = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(await bookingsRanRecently(10)).toBe(true);
    db.state.last_run_at = new Date(Date.now() - 20 * 60_000).toISOString();
    expect(await bookingsRanRecently(10)).toBe(false);
    db.state.last_run_at = null;
    expect(await bookingsRanRecently(10)).toBe(false);
  });
});
