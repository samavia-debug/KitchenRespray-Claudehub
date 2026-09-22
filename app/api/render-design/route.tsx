import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "edge";

const DEFAULT_COLORS = {
  green: "#2d3b2e",
  cream: "#f6f1e7",
  white: "#ffffff",
  text: "#2a2a2a",
};

type Colors = typeof DEFAULT_COLORS;

/**
 * Reads up to 2 hex colours out of company_profile.brand_colours (a free-
 * text field, e.g. "Dark green #2d3b2e and cream #f6f1e7") and uses them
 * as the primary/background colours. Falls back to the original defaults
 * for anything not found, so this never breaks before Company Knowledge
 * is filled in.
 */
function resolveColors(brandColours: string | null | undefined): Colors {
  const hexMatches = (brandColours || "").match(/#[0-9a-fA-F]{6}\b/g) || [];
  return {
    green: hexMatches[0] || DEFAULT_COLORS.green,
    cream: hexMatches[1] || DEFAULT_COLORS.cream,
    white: DEFAULT_COLORS.white,
    text: DEFAULT_COLORS.text,
  };
}

const CANVAS_WIDTH = 1080;
const CANVAS_PADDING = 60;
const CONTENT_WIDTH = CANVAS_WIDTH - CANVAS_PADDING * 2; // 960
const PHOTO_HEIGHT = 340;
const SPLIT_GAP = 4;
const SPLIT_HALF_WIDTH = (CONTENT_WIDTH - SPLIT_GAP) / 2; // 478

type Block =
  | { type: "badge"; text: string }
  | { type: "stars" }
  | { type: "big_headline"; text: string }
  | { type: "pull_quote"; text: string }
  | { type: "body_text"; text: string }
  | { type: "author_line"; text: string }
  | { type: "stat_highlight"; stat: string; label: string }
  | { type: "photo_split" }
  | { type: "photo_single" }
  | { type: "cta_footer"; text: string };

type PhotoUrls = {
  photo_url: string | null;
  photo_before_url: string | null;
  photo_after_url: string | null;
};

function renderBlock(block: Block, key: number, photos: PhotoUrls, colors: Colors) {
  switch (block.type) {
    case "badge":
      return (
        <div
          key={key}
          style={{
            display: "flex",
            alignItems: "center",
            padding: "10px 22px",
            borderRadius: "999px",
            background: "rgba(45,59,46,0.08)",
            color: colors.green,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          {block.text}
        </div>
      );

    case "stars":
      return (
        <div key={key} style={{ display: "flex", gap: "6px" }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                display: "flex",
                width: 34,
                height: 34,
                background: colors.green,
                clipPath:
                  "polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
              }}
            />
          ))}
        </div>
      );

    case "big_headline":
      return (
        <div
          key={key}
          style={{
            display: "flex",
            fontSize: 58,
            fontWeight: 800,
            color: colors.green,
            lineHeight: 1.15,
          }}
        >
          {block.text}
        </div>
      );

    case "pull_quote":
      return (
        <div
          key={key}
          style={{
            display: "flex",
            fontSize: 40,
            fontStyle: "italic",
            color: colors.text,
            lineHeight: 1.3,
          }}
        >
          {block.text}
        </div>
      );

    case "body_text":
      return (
        <div
          key={key}
          style={{ display: "flex", fontSize: 30, color: colors.text, lineHeight: 1.4 }}
        >
          {block.text}
        </div>
      );

    case "author_line":
      return (
        <div
          key={key}
          style={{ display: "flex", fontSize: 26, fontWeight: 700, color: colors.green }}
        >
          {block.text}
        </div>
      );

    case "stat_highlight":
      return (
        <div key={key} style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 84, fontWeight: 900, color: colors.green }}>
            {block.stat}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: colors.text }}>{block.label}</div>
        </div>
      );

    case "photo_split": {
      const hasPhotos = photos.photo_before_url && photos.photo_after_url;
      return (
        <div
          key={key}
          style={{ display: "flex", width: CONTENT_WIDTH, height: PHOTO_HEIGHT, gap: SPLIT_GAP }}
        >
          {hasPhotos ? (
            <>
              <img
                src={photos.photo_before_url as string}
                width={SPLIT_HALF_WIDTH}
                height={PHOTO_HEIGHT}
                style={{ objectFit: "cover" }}
              />
              <img
                src={photos.photo_after_url as string}
                width={SPLIT_HALF_WIDTH}
                height={PHOTO_HEIGHT}
                style={{ objectFit: "cover" }}
              />
            </>
          ) : (
            <div
              style={{
                display: "flex",
                width: CONTENT_WIDTH,
                height: PHOTO_HEIGHT,
                background: "#d9d3c4",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                color: "#7a7368",
              }}
            >
              Before / After photo
            </div>
          )}
        </div>
      );
    }

    case "photo_single": {
      const photoUrl = photos.photo_url || photos.photo_after_url;
      return (
        <div key={key} style={{ display: "flex", width: CONTENT_WIDTH, height: PHOTO_HEIGHT }}>
          {photoUrl ? (
            <img
              src={photoUrl}
              width={CONTENT_WIDTH}
              height={PHOTO_HEIGHT}
              style={{ objectFit: "cover" }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: CONTENT_WIDTH,
                height: PHOTO_HEIGHT,
                background: "#d9d3c4",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                color: "#7a7368",
              }}
            >
              Photo
            </div>
          )}
        </div>
      );
    }

    case "cta_footer":
      return (
        <div
          key={key}
          style={{
            display: "flex",
            width: "100%",
            background: colors.green,
            color: colors.white,
            padding: "22px 30px",
            fontSize: 24,
            fontWeight: 700,
            justifyContent: "center",
            marginTop: "auto",
          }}
        >
          {block.text}
        </div>
      );

    default:
      return null;
  }
}

export async function POST(request: Request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return new Response(JSON.stringify({ error: "Missing id" }), { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: designRequest, error } = await supabase
      .from("design_requests")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !designRequest) {
      return new Response(JSON.stringify({ error: "Design request not found" }), {
        status: 404,
      });
    }

    const blocks: Block[] = designRequest.generated_blocks || [];

    if (!blocks.length) {
      return new Response(
        JSON.stringify({ error: "No blocks found — generate content first" }),
        { status: 400 }
      );
    }

    const photos: PhotoUrls = {
      photo_url: designRequest.photo_url || null,
      photo_before_url: designRequest.photo_before_url || null,
      photo_after_url: designRequest.photo_after_url || null,
    };

    const { data: companyProfile } = await supabase
      .from("company_profile")
      .select("brand_colours")
      .eq("id", 1)
      .maybeSingle();
    const colors = resolveColors(companyProfile?.brand_colours);

    const imageResponse = new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: `${CANVAS_WIDTH}px`,
            height: `${CANVAS_WIDTH}px`,
            background: colors.cream,
            padding: `${CANVAS_PADDING}px`,
            gap: "28px",
          }}
        >
          {blocks.map((block, i) => renderBlock(block, i, photos, colors))}
        </div>
      ),
      { width: CANVAS_WIDTH, height: CANVAS_WIDTH }
    );

    const arrayBuffer = await imageResponse.arrayBuffer();
    const fileName = `rendered-${id}-${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from("design-previews")
      .upload(fileName, arrayBuffer, { contentType: "image/png", upsert: true });

    if (uploadError) {
      return new Response(JSON.stringify({ error: uploadError.message }), { status: 500 });
    }

    const { data: publicUrlData } = supabase.storage
      .from("design-previews")
      .getPublicUrl(fileName);

    await supabase
      .from("design_requests")
      .update({ rendered_image_url: publicUrlData.publicUrl })
      .eq("id", id);

    return new Response(
      JSON.stringify({ success: true, image_url: publicUrlData.publicUrl }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
      status: 500,
    });
  }
}
