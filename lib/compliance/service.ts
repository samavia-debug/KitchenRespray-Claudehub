import { createServiceClient } from "@/lib/supabase/service";
import { notifySlack, notifyWhatsApp } from "@/lib/monitoring/notify";
import { dublinDateKey } from "@/lib/connecteam/time-clock-summary";
import { getVehicleOverview } from "@/lib/connecteam/vehicles-sync";
import { buildExtractionPrompt, EXTRACT_RULES, itemKey, parseExtraction, shouldScan } from "./extract";
import {
  alertMessage,
  findGaps,
  formatComplianceContext,
  pendingAlerts,
  summariseCompliance,
  type ComplianceItem,
  type ComplianceSummary,
  type Gaps,
} from "./summary";

const COLUMNS =
  "id, document_id, title, kind, holder_type, holder_label, issued_date, expiry_date, status, source, evidence, needs_check, notes, alerted_stage";

export const todayKey = () => dublinDateKey(Date.now());

export async function loadItems(): Promise<ComplianceItem[]> {
  const { data, error } = await createServiceClient()
    .from("compliance_items")
    .select(COLUMNS)
    .order("expiry_date", { ascending: true, nullsFirst: false })
    .order("title");
  if (error) throw new Error(error.message);
  return (data || []) as ComplianceItem[];
}

/** Regular (not former) vans and drivers, from the vehicle checks, so gaps are only reported for what is really in use. */
async function loadFleet(): Promise<{ vehicles: { reg: string; key: string }[]; drivers: string[] }> {
  try {
    const { overview } = await getVehicleOverview();
    return {
      vehicles: overview.vehicles.filter((v) => v.regular).map((v) => ({ reg: v.reg, key: v.key })),
      drivers: overview.regularDrivers.map((d) => d.name),
    };
  } catch {
    return { vehicles: [], drivers: [] };
  }
}

export type Register = {
  items: ComplianceItem[];
  summary: ComplianceSummary;
  gaps: Gaps;
  vehicleCount: number;
  driverCount: number;
  unscannedDocuments: number;
};

export async function getRegister(): Promise<Register> {
  const [items, fleet, unscanned] = await Promise.all([loadItems(), loadFleet(), countUnscanned()]);
  return {
    items,
    summary: summariseCompliance(items, todayKey()),
    gaps: findGaps(items, fleet.vehicles, fleet.drivers),
    vehicleCount: fleet.vehicles.length,
    driverCount: fleet.drivers.length,
    unscannedDocuments: unscanned,
  };
}

export async function getComplianceContextForEleven(): Promise<string> {
  try {
    const r = await getRegister();
    if (r.items.length === 0 && r.vehicleCount === 0) return "";
    return formatComplianceContext(r.summary, r.gaps, r.vehicleCount, r.driverCount);
  } catch {
    return "";
  }
}

// ---- Reading documents ----

async function countUnscanned(): Promise<number> {
  const { count } = await createServiceClient()
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("extraction_status", "done")
    .is("compliance_scanned_at", null);
  return count ?? 0;
}

function excerpt(text: string): string {
  const max = EXTRACT_RULES.maxTextChars;
  if (text.length <= max) return text;
  // Dates often sit at the very end (signature block, schedule), so keep both ends.
  const tail = Math.floor(max / 4);
  return `${text.slice(0, max - tail)}\n[...]\n${text.slice(-tail)}`;
}

async function askModel(title: string, category: string | null, text: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1500,
      system: buildExtractionPrompt(),
      messages: [{ role: "user", content: `Document title: ${title}\nCategory: ${category ?? "none"}\n\n<document>\n${excerpt(text)}\n</document>` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API error (HTTP ${res.status})`);
  const body = await res.json();
  const block = body.content?.find((c: { type: string }) => c.type === "text");
  return block?.text || "";
}

export type ScanResult = { scanned: number; suggested: number; skipped: number; remaining: number; errors: string[] };

/**
 * Reads up to `limit` documents that have not been checked yet and stores what
 * is found as suggestions. A document is marked as scanned only when it was
 * actually read (or had nothing to read), so a failed model call is retried
 * on the next scan rather than silently skipped for good.
 */
export async function scanDocuments(limit: number, documentId?: string): Promise<ScanResult> {
  const supabase = createServiceClient();
  let q = supabase
    .from("knowledge_documents")
    .select("id, title, category, extracted_content")
    .eq("extraction_status", "done")
    .order("created_at", { ascending: true })
    .limit(limit);
  q = documentId ? q.eq("id", documentId) : q.is("compliance_scanned_at", null);

  const { data: docs, error } = await q;
  if (error) throw new Error(error.message);

  // Everything already on the register (including dismissed) so a rescan does not bring a rejected suggestion back.
  const existing = await loadItems();
  const seen = new Set(existing.map(itemKey));

  const result: ScanResult = { scanned: 0, suggested: 0, skipped: 0, remaining: 0, errors: [] };

  for (const doc of docs || []) {
    const text = (doc.extracted_content as string | null) ?? "";
    let found: ReturnType<typeof parseExtraction> = [];

    if (shouldScan(doc.category as string | null, text)) {
      try {
        found = parseExtraction(await askModel(doc.title as string, doc.category as string | null, text), text);
      } catch (err: any) {
        result.errors.push(`${doc.title}: ${err.message || "could not be read"}`);
        continue;
      }
    } else {
      result.skipped++;
    }

    const fresh = found.filter((i) => !seen.has(itemKey(i)));
    if (fresh.length > 0) {
      const { error: insertError } = await supabase.from("compliance_items").insert(
        fresh.map((i) => ({ ...i, document_id: doc.id, status: "suggested", source: "extracted" }))
      );
      if (insertError) {
        result.errors.push(`${doc.title}: ${insertError.message}`);
        continue;
      }
      fresh.forEach((i) => seen.add(itemKey(i)));
      result.suggested += fresh.length;
    }

    await supabase.from("knowledge_documents").update({ compliance_scanned_at: new Date().toISOString() }).eq("id", doc.id);
    result.scanned++;
  }

  result.remaining = await countUnscanned();
  return result;
}

// ---- Warnings ----

function notificationsConfigured(): boolean {
  const e = process.env;
  const whatsapp = e.TWILIO_ACCOUNT_SID && e.TWILIO_AUTH_TOKEN && e.TWILIO_WHATSAPP_FROM && e.TWILIO_WHATSAPP_TO;
  return !!(e.SLACK_WEBHOOK_URL || whatsapp);
}

/**
 * Sends one message for everything that has newly reached a warning stage,
 * then records the stage so each warning goes out once. Nothing is recorded
 * when no channel is configured, so the warnings are not lost: they go out
 * as soon as Slack or WhatsApp is set up.
 */
export async function sendComplianceAlerts(): Promise<{ sent: number; skipped: string | null }> {
  const items = await loadItems();
  const alerts = pendingAlerts(items, todayKey());
  if (alerts.length === 0) return { sent: 0, skipped: null };
  if (!notificationsConfigured()) return { sent: 0, skipped: "no Slack or WhatsApp channel configured" };

  const message = alertMessage(alerts);
  await Promise.all([notifySlack(message), notifyWhatsApp(message)]);

  const supabase = createServiceClient();
  await Promise.all(alerts.map((a) => supabase.from("compliance_items").update({ alerted_stage: a.stage }).eq("id", a.item.id)));
  return { sent: alerts.length, skipped: null };
}
