import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const POST_TYPES = [
  {
    key: "before_after",
    label: "Before & After Transformation",
    guidance:
      "Focus on the visual transformation: colour change, cabinet transformation, overall improvement, modernisation. Structure: what it looked like before, what it looks like now. End with 'Respray it, Don't Replace it.'",
  },
  {
    key: "project_showcase",
    label: "Project Showcase",
    guidance:
      "Showcase a completed project. Mention the transformation, colours used (if relevant), and give a short description of the work. Feels like a proud reveal of finished work.",
  },
  {
    key: "educational",
    label: "Educational / Helpful Tip",
    guidance:
      "Teach the customer something: how respraying works, respray vs replace, how much they can save, how long it takes, what colours are available, how to maintain a resprayed kitchen. Helpful and informative, not salesy.",
  },
  {
    key: "inspiration",
    label: "Kitchen Inspiration / Colour Trends",
    guidance:
      "Inspire the customer with colour ideas, modern combinations, or kitchen trends. Help them imagine what their own kitchen could look like. Light, aspirational tone.",
  },
  {
    key: "testimonial",
    label: "Customer Review / Testimonial",
    guidance:
      "Centre the post around genuine-feeling customer feedback and trust. Reference the customer's satisfaction and the quality of the result. Builds credibility.",
  },
  {
    key: "promotional",
    label: "Promotional / Offer",
    guidance:
      "Highlight a promotion or special offer, but focus on value delivered, not just 'SALE'. Keep it benefit-led, not aggressive.",
  },
  {
    key: "local_seo",
    label: "Local / Location-Specific",
    guidance:
      "Target a specific Irish county or area (e.g. Dublin, Kildare, Meath, Louth, Kilkenny, Carlow, Laois, Offaly, Longford) naturally within useful content, not just repeating the location name.",
  },
];

// The visual building blocks Claude is allowed to compose a design from.
// Each block has a fixed set of props it accepts — this keeps every design
// renderable while still giving Claude real creative control over which
// blocks to use, in what order, and with what content.
const BLOCK_LIBRARY = `
Available visual blocks (choose and order any combination that fits the post_type):

- "badge": a small pill-shaped label at the top, e.g. "VERIFIED CUSTOMER REVIEW" or "NEW COLOUR TREND". props: { text }
- "stars": a 5-star rating row. props: {} (no props needed)
- "big_headline": large bold headline text, the main hook. props: { text }
- "pull_quote": large italic/serif quote styling, for testimonials. props: { text }
- "body_text": a paragraph of regular-weight text, for educational or informative content. props: { text }
- "author_line": small attribution line, e.g. "— Sarah M.". props: { text }
- "stat_highlight": one big bold number/stat with a short label underneath, e.g. "80%" / "Average saving vs replacement". props: { stat, label }
- "photo_split": a before/after side-by-side image layout with labels. props: {} (photos are added separately, just include this block if the post needs it)
- "photo_single": a single full-width photo area. props: {} 
- "cta_footer": the bottom bar with logo, contact info and CTA text. props: { text } (always include this block last — it is the brand footer)

Brand colours: dark green (#2d3b2e approx) and cream/off-white background, matching the existing KitchenRespray visual identity. Use a clean modern sans-serif for headlines/UI text, and an elegant serif for pull-quotes/testimonials (matching the reference example).
`;

export async function POST(request: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "Missing request id" }, { status: 400 });
  }

  const { data: designRequest, error: requestError } = await supabase
    .from("design_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (requestError || !designRequest) {
    return NextResponse.json({ error: "Design request not found" }, { status: 404 });
  }

  const { data: companyProfile } = await supabase
    .from("company_profile")
    .select("*")
    .eq("id", 1)
    .single();

  const { data: serviceLine } = await supabase
    .from("service_lines")
    .select("*")
    .eq("name", designRequest.service_line)
    .single();

  const { data: recentRequests } = await supabase
    .from("design_requests")
    .select("generated_post_type")
    .eq("service_line", designRequest.service_line)
    .not("generated_post_type", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const recentTypes = (recentRequests || [])
    .map((r) => r.generated_post_type)
    .filter(Boolean);

  const postTypeMenu = POST_TYPES.map(
    (t) => `- ${t.key}: ${t.label} — ${t.guidance}`
  ).join("\n");

  const systemPrompt = `You are a marketing content AND layout designer for KitchenRespray.com, a kitchen respraying service. You write on-brand social copy AND compose the visual layout for each post using a fixed library of design blocks.

Available post types:
${postTypeMenu}

Recently used post types for this service line (most recent first): ${
    recentTypes.length ? recentTypes.join(", ") : "None yet"
  }

Choose the post type that best fits the brief. If the brief doesn't clearly call for a specific type, choose a type that is DIFFERENT from the recently used ones above, so content stays varied. Do not default to before_after unless it's genuinely the best fit or the brief asks for it.

${BLOCK_LIBRARY}

Always respond with ONLY a valid JSON object, no other text, no markdown formatting, in this exact shape:
{
  "post_type": "one of the post type keys",
  "headline": "short version for internal reference",
  "caption": "the social media caption text, written for the platform",
  "cta": "the call to action text",
  "blocks": [
    { "type": "badge", "text": "..." },
    { "type": "big_headline", "text": "..." },
    { "type": "cta_footer", "text": "..." }
  ]
}

The "blocks" array is the actual visual design — choose blocks and content that genuinely fit the post_type (e.g. testimonial posts should use badge + stars + pull_quote + author_line + cta_footer; educational posts might use big_headline + body_text + stat_highlight + cta_footer; before/after posts should use photo_split + a short headline + cta_footer). Vary the composition meaningfully between post types — don't reuse the same block structure every time.`;

  const userPrompt = `
Company: ${companyProfile?.company_name || ""}
Company description: ${companyProfile?.description || ""}
Brand voice: ${companyProfile?.brand_voice || ""}
Taglines/core messages: ${companyProfile?.taglines || ""}
Language rules: ${companyProfile?.language_rules || ""}

Service line: ${serviceLine?.name || designRequest.service_line}
Service description: ${serviceLine?.description || ""}
Target customer: ${serviceLine?.target_customer || ""}
Key benefits: ${serviceLine?.key_benefits || ""}
CTA guidance: ${serviceLine?.cta_guidance || ""}

Design type: ${designRequest.design_type}
Platform: ${designRequest.platform}
Brief: ${designRequest.brief}
Additional instructions: ${designRequest.additional_instructions || "None"}

Pick the best post_type (favouring variety, per the instructions), write the caption and cta, then compose the "blocks" array — the actual visual layout — using only blocks from the library above. Make sure the block composition genuinely matches the post_type and feels intentional, not generic.
`;

  try {
    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!anthropicResponse.ok) {
      const errText = await anthropicResponse.text();
      return NextResponse.json(
        { error: `Claude API error: ${errText}` },
        { status: 500 }
      );
    }

    const anthropicData = await anthropicResponse.json();
    const textBlock = anthropicData.content?.find((c: any) => c.type === "text");
    const rawText = textBlock?.text || "{}";

    let parsed;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Could not parse Claude's response", raw: rawText },
        { status: 500 }
      );
    }

    const { error: updateError } = await supabase
      .from("design_requests")
      .update({
        generated_headline: parsed.headline || null,
        generated_caption: parsed.caption || null,
        generated_cta: parsed.cta || null,
        generated_design_notes: null, // replaced by structured blocks below
        generated_post_type: parsed.post_type || null,
        generated_blocks: parsed.blocks || null, // requires new jsonb column, see next step
        status: "generated",
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, ...parsed });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
