import type { InspectionRow } from "./vehicles";

const DAY = 86_400_000;

// Every rule below is stated here once and repeated to Eleven in its prompt,
// so an answer like "5 drivers are missing" always says what "missing" means.
export const RULES = {
  regularVehicleMinReports: 2,
  regularVehicleWindowDays: 90,
  overdueAfterDays: 14,
  regularDriverWindowDays: 60,
  missingWindowDays: 7,
} as const;

export type SummaryRow = Pick<
  InspectionRow,
  | "vehicle_key"
  | "vehicle_reg"
  | "make_model"
  | "submitted_at"
  | "submitter_user_id"
  | "driver_name"
  | "odometer_text"
  | "odometer_km"
  | "trip_type"
  | "defects"
  | "safety_equipment_ok"
  | "condition_ok"
>;

export type StaffRef = { userId: number; name: string; former: boolean };

export type VehicleSummary = {
  key: string;
  reg: string;
  makeModel: string | null;
  lastInspectedAt: string;
  daysSince: number;
  lastDriver: string | null;
  lastOdometerKm: number | null;
  lastTrip: string | null;
  lastDefects: string[];
  lastConditionOk: boolean | null;
  lastSafetyEquipmentOk: boolean | null;
  reports90: number;
  defectReports90: number;
  regular: boolean;
  overdue: boolean;
};

export type DefectReport = {
  submittedAt: string;
  reg: string;
  defects: string[];
  conditionOk: boolean | null;
  driver: string | null;
};

export type DriverRef = { userId: number; name: string };

export type VehicleOverview = {
  generatedAt: string;
  totals: { reports7: number; reports30: number; vehiclesInspected30: number };
  vehicles: VehicleSummary[];
  regularVehicles: number;
  overdueVehicles: number;
  safetyEquipmentMissingOnRegular: number;
  regularDrivers: DriverRef[];
  missingDrivers: DriverRef[];
  recentDefects: DefectReport[];
};

const hasProblem = (r: Pick<SummaryRow, "defects" | "condition_ok">) => r.defects.length > 0 || r.condition_ok === false;

export function summariseVehicles(rows: SummaryRow[], staff: StaffRef[], nowMs: number = Date.now()): VehicleOverview {
  const t = (r: SummaryRow) => new Date(r.submitted_at).getTime();
  const sorted = [...rows].sort((a, b) => t(b) - t(a));
  const since = (days: number) => nowMs - days * DAY;

  const byVehicle = new Map<string, SummaryRow[]>();
  for (const r of sorted) {
    const list = byVehicle.get(r.vehicle_key);
    if (list) list.push(r);
    else byVehicle.set(r.vehicle_key, [r]);
  }

  const vehicles: VehicleSummary[] = [];
  for (const [key, list] of Array.from(byVehicle.entries())) {
    const recent = list.filter((r) => t(r) >= since(RULES.regularVehicleWindowDays));
    if (recent.length === 0) continue; // not seen for 90 days: dormant, not listed

    const latest = list[0];
    const daysSince = Math.floor((nowMs - t(latest)) / DAY);
    const regular = recent.length >= RULES.regularVehicleMinReports;

    vehicles.push({
      key,
      reg: latest.vehicle_reg,
      makeModel: list.find((r) => r.make_model)?.make_model ?? null,
      lastInspectedAt: latest.submitted_at,
      daysSince,
      lastDriver: latest.driver_name,
      lastOdometerKm: list.find((r) => r.odometer_km !== null)?.odometer_km ?? null,
      lastTrip: latest.trip_type,
      lastDefects: latest.defects,
      lastConditionOk: latest.condition_ok,
      lastSafetyEquipmentOk: latest.safety_equipment_ok,
      reports90: recent.length,
      defectReports90: recent.filter(hasProblem).length,
      regular,
      overdue: regular && daysSince > RULES.overdueAfterDays,
    });
  }

  // Overdue first (worst first), then the other regular vehicles, then one-offs.
  vehicles.sort((a, b) => {
    const rank = (v: VehicleSummary) => (v.overdue ? 0 : v.regular ? 1 : 2);
    return rank(a) - rank(b) || (a.overdue ? b.daysSince - a.daysSince : a.reg.localeCompare(b.reg));
  });

  const nameById = new Map(staff.map((s) => [s.userId, s]));
  const driverWindow = sorted.filter((r) => r.submitter_user_id !== null && t(r) >= since(RULES.regularDriverWindowDays));
  const regularIds = Array.from(new Set(driverWindow.map((r) => r.submitter_user_id as number)));
  const submittedThisWeek = new Set(
    sorted.filter((r) => r.submitter_user_id !== null && t(r) >= since(RULES.missingWindowDays)).map((r) => r.submitter_user_id)
  );

  const toRef = (userId: number): DriverRef => ({ userId, name: nameById.get(userId)?.name ?? `Connecteam user ${userId}` });
  // Someone who has since left isn't "missing", they're gone.
  const regularDrivers = regularIds.filter((id) => !nameById.get(id)?.former).map(toRef);
  const missingDrivers = regularDrivers.filter((d) => !submittedThisWeek.has(d.userId));

  const regular = vehicles.filter((v) => v.regular);

  return {
    generatedAt: new Date(nowMs).toISOString(),
    totals: {
      reports7: sorted.filter((r) => t(r) >= since(7)).length,
      reports30: sorted.filter((r) => t(r) >= since(30)).length,
      vehiclesInspected30: new Set(sorted.filter((r) => t(r) >= since(30)).map((r) => r.vehicle_key)).size,
    },
    vehicles,
    regularVehicles: regular.length,
    overdueVehicles: regular.filter((v) => v.overdue).length,
    safetyEquipmentMissingOnRegular: regular.filter((v) => v.lastSafetyEquipmentOk === false).length,
    regularDrivers,
    missingDrivers,
    recentDefects: sorted
      .filter((r) => t(r) >= since(60) && hasProblem(r))
      .slice(0, 40)
      .map((r) => ({ submittedAt: r.submitted_at, reg: r.vehicle_reg, defects: r.defects, conditionOk: r.condition_ok, driver: r.driver_name })),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const yn = (v: boolean | null) => (v === null ? "not recorded" : v ? "yes" : "no");

/** Plain-text block handed to Eleven. Lists are pre-computed so it quotes them instead of re-counting. */
export function formatVehicleContext(o: VehicleOverview, lastSyncedAt: string | null): string {
  const lines: string[] = [];
  lines.push(
    `Source: Connecteam "Weekly Driver's Vehicle Inspection Report"${lastSyncedAt ? `, last synced ${formatDate(lastSyncedAt)}` : ""}.`,
    `Definitions: a regular vehicle has ${RULES.regularVehicleMinReports}+ reports in the last ${RULES.regularVehicleWindowDays} days; a regular driver has submitted at least one report in the last ${RULES.regularDriverWindowDays} days; "this week" means the last ${RULES.missingWindowDays} days; a vehicle is overdue when it has had no report for more than ${RULES.overdueAfterDays} days. Drivers are matched by their Connecteam login, not the name they typed.`,
    `Totals: ${o.totals.reports7} reports in the last 7 days, ${o.totals.reports30} in the last 30 days, covering ${o.totals.vehiclesInspected30} vehicles. ${o.regularVehicles} regular vehicles, ${o.overdueVehicles} overdue. On the latest report of ${o.safetyEquipmentMissingOnRegular} regular vehicles the safety equipment (fire extinguisher / first aid kit) was marked missing.`
  );

  lines.push(
    o.regularDrivers.length
      ? `Regular drivers who have NOT submitted in the last ${RULES.missingWindowDays} days (${o.missingDrivers.length} of ${o.regularDrivers.length}): ${o.missingDrivers.map((d) => d.name).join(", ") || "none"}.`
      : "No regular drivers identified."
  );

  lines.push("Vehicles (overdue first):");
  for (const v of o.vehicles.slice(0, 60)) {
    const tag = v.overdue ? "OVERDUE" : v.regular ? "regular" : "one-off/rare";
    lines.push(
      `- ${v.reg}${v.makeModel ? ` (${v.makeModel})` : ""} [${tag}]: last report ${formatDate(v.lastInspectedAt)} (${v.daysSince} days ago)${v.lastDriver ? ` by ${v.lastDriver}` : ""}; ` +
        `${v.lastTrip ?? "trip type not recorded"}; odometer ${v.lastOdometerKm !== null ? v.lastOdometerKm.toLocaleString("en-IE") : "not recorded"}; ` +
        `latest defects: ${v.lastDefects.length ? v.lastDefects.join(", ") : "none"}; condition acceptable: ${yn(v.lastConditionOk)}; safety equipment present: ${yn(v.lastSafetyEquipmentOk)}; ` +
        `${v.reports90} reports in 90 days, ${v.defectReports90} with defects`
    );
  }

  lines.push(`Defect reports in the last 60 days (newest first, ${o.recentDefects.length}):`);
  for (const d of o.recentDefects) {
    lines.push(
      `- ${formatDate(d.submittedAt)} ${d.reg}: ${d.defects.length ? d.defects.join(", ") : "no item ticked"}; condition acceptable: ${yn(d.conditionOk)}${d.driver ? `; driver ${d.driver}` : ""}`
    );
  }
  if (o.recentDefects.length === 0) lines.push("- none");

  return lines.join("\n");
}
