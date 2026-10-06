import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/session";
import { isConnecteamConfigured } from "@/lib/connecteam/client";
import { getVehicleOverview, getVehicleStatus, syncVehicleInspections } from "@/lib/connecteam/vehicles-sync";

export const maxDuration = 60;

export async function GET() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  try {
    const [status, { overview }] = await Promise.all([getVehicleStatus(), getVehicleOverview()]);
    return NextResponse.json({ ...status, overview });
  } catch (err: any) {
    // Most likely the vehicle_inspections table hasn't been created yet.
    return NextResponse.json({ error: err.message || "Could not load vehicle data" }, { status: 500 });
  }
}

export async function POST() {
  const auth = await requireRole(["Admin"]);
  if ("error" in auth) return auth.error;

  if (!isConnecteamConfigured()) {
    return NextResponse.json({ error: "Connecteam isn't connected yet — CONNECTEAM_API_KEY is not set." }, { status: 400 });
  }

  try {
    return NextResponse.json(await syncVehicleInspections());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Vehicle sync failed" }, { status: 500 });
  }
}
