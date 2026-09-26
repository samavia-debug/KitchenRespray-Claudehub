import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Distinct compositions, not just different copy in the same box — this is
// what actually varies the LAYOUT (see app/api/render-design/route.tsx,
// which implements one renderer per key). Persisted in the repurposed
// generated_design_notes column (no longer used for its original purpose
// now that blocks replaced free-text design notes).
const LAYOUTS = [
  {
    key: "stacked",
    label: "Stacked Card",
    guidance:
      "A single vertical card on a plain light background: badge, one photo area, headline, body copy, CTA footer stacked top to bottom. Safe and clean, works for any post type. Best when there's a lot of text to fit (educational content) or when no strong single photo is available.",
  },
  {
    key: "dark_stacked",
    label: "Dark Stacked Card",
    guidance:
      "Same vertical stacked composition as Stacked Card, but inverted to a bold dark background with light text and a bright accent headline. Best for a confident, high-impact statement — promotional offers, brand-awareness posts, a strong claim or stat. Gives real visual contrast against the (much more common) light layouts. Does not require a photo.",
  },
  {
    key: "quote_hero",
    label: "Quote Hero",
    guidance:
      "Everything centered on a plain light background: badge, stars, a large centered pull-quote, author line, CTA footer. Built specifically for customer reviews/testimonials — do not use for anything else. Does not require a photo (and won't show one even if blocks include a photo block).",
  },
  {
    key: "color_block",
    label: "Colour Block",
    guidance:
      "A bold solid-colour band across the top (badge + headline in light text) with a lighter section below for the rest of the copy and CTA — a genuine two-tone graphic composition, not just a uniform background. Does not require a photo. Good default alternative to Stacked Card / Dark Stacked when neither photo layout is available, so posts aren't limited to only two looks.",
  },
  {
    key: "stat_hero",
    label: "Stat Hero",
    guidance:
      "One number/stat rendered huge and centered (e.g. '80%' filling most of the canvas) with a short supporting line and CTA footer. Only choose this when the content genuinely has a strong stat/number to lead with (e.g. cost savings, time saved) — requires a stat_highlight block. Does not require a photo.",
  },
  {
    key: "photo_overlay",
    label: "Full-Bleed Photo Overlay",
    guidance:
      "One photo fills the entire canvas edge to edge with a dark gradient at the bottom and the headline/CTA overlaid in light text near the bottom. Best for a single striking photo — promotional offers, inspiration, local/location posts, a great single 'after' shot. Only choose this if a photo is actually available (see 'Photos available' below) — never choose it when there is no photo.",
  },
  {
    key: "split",
    label: "Split Panel",
    guidance:
      "Canvas splits into two halves side by side: a colour panel with the headline/body/CTA on one side, the photo(s) filling the other side full-height. Best for before/after comparisons or project showcases pairing a photo with a short punchy message. Only choose this if at least one photo is available — never choose it when there is no photo.",
  },
];

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
//
// Brand colours/fonts are read from company_profile (Company Knowledge)
// rather than hardcoded — falls back to the render engine's own defaults
// (see app/api/render-design/route.tsx's COLORS) only when the profile
// hasn't been filled in yet, so this doesn't break before that happens.
function buildBlockLibrary(companyProfile: { brand_colours?: string | null; brand_fonts?: string | null } | null) {
  const colours = companyProfile?.brand_colours?.trim() || "dark green (#2d3b2e) and cream/off-white background (default — set Brand colours in Company Knowledge to change this)";
  const fonts = companyProfile?.brand_fonts?.trim() || "a clean modern sans-serif for headlines/UI text, and an elegant serif for pull-quotes/testimonials (default — set Brand fonts in Company Knowledge to change this)";

  return `
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

Brand colours: ${colours}. Fonts: ${fonts}.
`;
}

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
    .select("generated_post_type, generated_design_notes, generated_caption")
    .eq("service_line", designRequest.service_line)
    .not("generated_post_type", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);

  const recentTypes = (recentRequests || [])
    .map((r) => r.generated_post_type)
    .filter(Boolean);

  const recentLayouts = (recentRequests || [])
    .map((r) => r.generated_design_notes)
    .filter(Boolean);

  // First ~8 words only — enough to catch a repeated opening move ("Another
  // kitchen transformed...", "This [X] kitchen had...") without asking
  // Claude to avoid entire real captions, which would over-constrain it.
  const recentOpenings = (recentRequests || [])
    .map((r) => r.generated_caption?.trim().split(/\s+/).slice(0, 8).join(" "))
    .filter((s): s is string => Boolean(s));

  const postTypeMenu = POST_TYPES.map(
    (t) => `- ${t.key}: ${t.label} — ${t.guidance}`
  ).join("\n");

  const hasPhoto = Boolean(
    designRequest.photo_url || designRequest.photo_before_url || designRequest.photo_after_url
  );
  const hasBeforeAfter = Boolean(designRequest.photo_before_url && designRequest.photo_after_url);

  const layoutMenu = LAYOUTS.map((l) => `- ${l.key}: ${l.label} — ${l.guidance}`).join("\n");

  const companyName = companyProfile?.company_name?.trim() || "the company";
  const companyDescription = companyProfile?.description?.trim();

  const systemPrompt = `You are a marketing content AND layout designer for ${companyName}${companyDescription ? `, ${companyDescription}` : ""}. You write on-brand social copy AND compose the visual layout for each post using a fixed library of design blocks.

Available post types:
${postTypeMenu}

Recently used post types for this service line (most recent first): ${
    recentTypes.length ? recentTypes.join(", ") : "None yet"
  }

Choose the post type that best fits the brief. If the brief doesn't clearly call for a specific type, choose a type that is DIFFERENT from the recently used ones above, so content stays varied. Do not default to before_after unless it's genuinely the best fit or the brief asks for it.

Available layouts (this controls the overall visual composition, not just the copy — pick deliberately, it's the main thing that makes posts look different from each other):
${layoutMenu}

Photos available for this request: ${
    hasPhoto
      ? hasBeforeAfter
        ? "before AND after photos"
        : designRequest.photo_before_url
        ? "before photo only"
        : designRequest.photo_after_url
        ? "after photo only"
        : "one single photo"
      : "none"
  }. Do not choose "photo_overlay" or "split" if no photo is available — use "stacked" instead in that case.

Recently used layouts for this service line (most recent first): ${
    recentLayouts.length ? recentLayouts.join(", ") : "None yet"
  }

Choose a layout that is DIFFERENT from the recently used ones above whenever a photo is available and more than one layout would genuinely work, so consecutive posts don't look the same. Only repeat a layout when it's clearly the best fit or no alternative is possible (e.g. no photo available).

Recent caption openings for this service line, first few words only (most recent first): ${
    recentOpenings.length ? recentOpenings.map((o) => `"${o}..."`).join("; ") : "None yet"
  }

Write a caption that opens differently from every one of those — a different sentence structure, not just different words in the same shape (e.g. don't always start "Another kitchen transformed..." or "This [X] kitchen had..."). Vary between: a direct question, a short punchy statement, a scene-setting description, a customer's-voice opening, or leading with the result before the backstory. The variety should be genuinely noticeable read back to back, not cosmetic.

${buildBlockLibrary(companyProfile)}

Always respond with ONLY a valid JSON object, no other text, no markdown formatting, in this exact shape:
{
  "post_type": "one of the post type keys",
  "layout": "one of the layout keys",
  "headline": "short version for internal reference",
  "caption": "the social media caption text, written for the platform",
  "cta": "the call to action text",
  "blocks": [
    { "type": "badge", "text": "..." },
    { "type": "big_headline", "text": "..." },
    { "type": "cta_footer", "text": "..." }
  ]
}

The "blocks" array is the content of the design — choose blocks and content that genuinely fit the post_type and the chosen layout (e.g. testimonial posts should use badge + stars + pull_quote + author_line + cta_footer; educational posts might use big_headline + body_text + stat_highlight + cta_footer; before/after posts should use a short headline + cta_footer, and can skip photo blocks entirely when layout is "photo_overlay" or "split" since those layouts place the photo themselves). Vary the composition meaningfully — don't reuse the same block structure every time.`;

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

Pick the best post_type and layout (favouring variety, per the instructions), write the caption and cta, then compose the "blocks" array using only blocks from the library above. Make sure the block composition genuinely matches the post_type and the chosen layout and feels intentional, not generic.
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

    const layoutKeys = LAYOUTS.map((l) => l.key);
    let layout = layoutKeys.includes(parsed.layout) ? parsed.layout : "stacked";
    if ((layout === "photo_overlay" || layout === "split") && !hasPhoto) {
      layout = "stacked";
    }

    const { error: updateError } = await supabase
      .from("design_requests")
      .update({
        generated_headline: parsed.headline || null,
        generated_caption: parsed.caption || null,
        generated_cta: parsed.cta || null,
        generated_design_notes: layout, // repurposed to store the chosen layout key
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
