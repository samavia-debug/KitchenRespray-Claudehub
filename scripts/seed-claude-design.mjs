import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const companyProfile = {
  company_name: "KitchenRespray.com",
  description:
    "KitchenRespray.com is a professional kitchen respraying service that helps homeowners transform dated or tired kitchens without the cost and disruption of completely replacing them. We respray existing cabinets to give them a completely fresh, modern appearance, saving customers up to 80% compared to a full kitchen replacement.",
  brand_voice:
    "Professional, friendly, helpful, confident, simple, positive, and modern. We sound like a knowledgeable professional giving a homeowner good advice, not a salesperson. Educate rather than sell. Keep sentences short and easy to read, written for someone quickly scrolling Facebook or Instagram. Use Irish English throughout.\n\nAvoid: corporate language, technical jargon, aggressive sales language, unrealistic promises, excessive emojis, long paragraphs, and anything that sounds generic or AI generated.",
  brand_colours: "#b7f900, #00212c, #ffffff",
  taglines:
    "Respray it, Don't Replace it.\nSave up to 80% compared to a new kitchen.\nTransform your existing kitchen.\nGive your kitchen a fresh, modern look.\nA new look without a full kitchen replacement.\nProfessional kitchen respraying.\n\nCore idea to plant in the customer's mind: \"Maybe I don't need to replace my kitchen. I can transform what I already have.\"",
  language_rules:
    "Use: Irish English spelling and phrasing. Benefit-led language (e.g. \"Give your kitchen a fresh new look without replacing the cabinets\" rather than \"We provide professional spray application services to kitchen cabinetry\").\n\nAvoid: overly corporate language, excessive technical terminology, aggressive sales language, unrealistic promises, overusing emojis, long paragraphs, generic or AI-sounding phrasing.\n\nPrimary CTA to favour: \"WhatsApp us a photo of your kitchen for a free quote: 083 83 555 83.\" Don't stack multiple CTAs in one post.",
};

const serviceLines = [
  {
    name: "Kitchen Respray",
    description:
      "Professional kitchen respraying service that gives dated kitchen cabinets a completely fresh, modern look without the cost and disruption of a full kitchen replacement.",
    target_customer:
      "Homeowners in Ireland with dated kitchen cabinets who want a modern look, are considering replacing their kitchen, want to change cabinet colour, or are preparing a property for sale.",
    key_benefits:
      "Save up to 80% compared to a new kitchen. Faster and less disruptive than a full replacement. Wide range of colours available. Professional, durable finish.",
    cta_guidance: "WhatsApp us a photo of your kitchen for a free quote: 083 83 555 83",
  },
  {
    name: "Kitchen Facelift",
    description:
      "Kitchen facelift service, replacing worn cabinet doors, drawer fronts, and handles while keeping the existing kitchen layout and carcasses, giving a modern new look at a fraction of full replacement cost.",
    target_customer:
      "Homeowners whose kitchen doors and fronts are worn or dated but whose cabinet structure is still in good condition, and who want a bigger visual change than a respray alone.",
    key_benefits:
      "Complete new look without replacing the whole kitchen. Faster and less disruptive than a full renovation. More affordable than a full kitchen replacement.",
    cta_guidance: "WhatsApp us a photo of your kitchen for a free quote: 083 83 555 83",
  },
  {
    name: "Bath Respray",
    description:
      "Professional bathroom respraying service covering baths, shower trays, and bathroom wall tiles, plus chip and bath repair, giving worn bathroom surfaces a fresh, like new finish without full replacement.",
    target_customer:
      "Homeowners with a dated, chipped, or discoloured bath, shower tray, or bathroom tiles who want a fresh look without the cost and disruption of a full bathroom renovation.",
    key_benefits:
      "Significant savings compared to replacing bath, shower tray, or tiles. Repairs chips and damage as part of the service. Faster than a full bathroom renovation. Wide range of colours available.",
    cta_guidance: "WhatsApp us a photo of your bathroom for a free quote: 083 83 555 83",
  },
  {
    name: "Furniture Respray",
    description:
      "Professional furniture respraying service that transforms tired or dated furniture with a fresh, durable finish, a cost effective alternative to replacing furniture entirely.",
    target_customer:
      "Homeowners with furniture that's dated, worn, or the wrong colour for their space, who want a refreshed look without buying new furniture.",
    key_benefits:
      "Cost effective alternative to buying new furniture. Wide range of colours available. Professional, durable finish. Gives furniture a completely new lease of life.",
    cta_guidance: "WhatsApp us a photo of your furniture for a free quote: 083 83 555 83",
  },
  {
    name: "Upvc Respray",
    description:
      "Professional UPVC respraying service for windows, doors, and frames, restoring faded or discoloured UPVC to a fresh, like new finish without the cost of full replacement.",
    target_customer:
      "Homeowners with UPVC windows, doors, or frames that have faded, discoloured, or dated in appearance but are still structurally sound.",
    key_benefits:
      "Significant savings compared to replacing UPVC windows or doors. Wide range of colours available. Restores a fresh, modern appearance. Faster than full replacement.",
    cta_guidance: "WhatsApp us a photo of your UPVC for a free quote: 083 83 555 83",
  },
  {
    name: "Worktop Respray",
    description:
      "Professional worktop respraying service that transforms dated or worn kitchen worktops with a fresh, durable finish, a cost effective alternative to replacing the worktop entirely.",
    target_customer:
      "Homeowners with a dated, worn, or discoloured kitchen worktop who want a refreshed look without the cost and disruption of a full worktop replacement.",
    key_benefits:
      "Significant savings compared to a new worktop. Faster and less disruptive than replacement. Wide range of colours and finishes available. Durable, professional result.",
    cta_guidance: "WhatsApp us a photo of your worktop for a free quote: 083 83 555 83",
  },
  {
    name: "Wrapping",
    description:
      "Professional wrapping service that applies a durable, high quality vinyl finish to surfaces, covering worktops, kitchens, doors, and bathrooms, giving a completely new look without replacement.",
    target_customer:
      "Homeowners who want a fast, affordable way to completely change the appearance of a surface (worktop, kitchen, door, or bathroom) without replacing it.",
    key_benefits:
      "Cost effective alternative to replacement. Wide range of finishes and colours available. Fast turnaround. Durable, professional result.",
    cta_guidance: "WhatsApp us a photo for a free quote: 083 83 555 83",
    subcategories: "Worktop Wrapping, Kitchen Wrapping, Door Wrapping, Bathroom Wrapping",
  },
];

const { error: profileError } = await supabase
  .from("company_profile")
  .update(companyProfile)
  .eq("id", 1);

if (profileError) {
  console.error("company_profile update failed:", profileError.message);
  process.exit(1);
}
console.log("company_profile updated");

const { error: serviceLinesError } = await supabase
  .from("service_lines")
  .upsert(serviceLines, { onConflict: "name" });

if (serviceLinesError) {
  console.error("service_lines upsert failed:", serviceLinesError.message);
  process.exit(1);
}
console.log(`service_lines upserted (${serviceLines.length} rows)`);

const { data: verifyProfile } = await supabase.from("company_profile").select("*").eq("id", 1).single();
const { data: verifyServiceLines } = await supabase.from("service_lines").select("name").order("id");

console.log("\nVerification:");
console.log("company_profile.company_name:", verifyProfile?.company_name);
console.log("company_profile.brand_colours:", verifyProfile?.brand_colours);
console.log("service_lines:", verifyServiceLines?.map((s) => s.name).join(", "));
