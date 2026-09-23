import { ImageResponse } from "next/og";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "edge";

const DEFAULT_COLORS = {
  green: "#2d3b2e",
  cream: "#f6f1e7",
  white: "#ffffff",
  text: "#2a2a2a",
};

type Colors = typeof DEFAULT_COLORS & { lightText: string };

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Reads hex colours out of company_profile.brand_colours (a free-text
 * field). With 3+ colours, roles are assigned by luminance rather than
 * input order — the darkest becomes body text, the lightest becomes the
 * page background, and the remaining (most likely the brand's bright
 * accent) becomes the primary colour used for headlines/badges/CTA
 * background, with its own text colour picked for contrast against it.
 * With 0-2 colours, falls back to the original order-based behaviour
 * (first = primary, second = background) to match the original 2-colour
 * "dark green + cream" design.
 */
function resolveColors(brandColours: string | null | undefined): Colors {
  const hexMatches = (brandColours || "").match(/#[0-9a-fA-F]{6}\b/g) || [];

  if (hexMatches.length >= 3) {
    const sorted = [...hexMatches].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
    const darkest = sorted[0];
    const lightest = sorted[sorted.length - 1];
    const accent = sorted.slice(1, -1)[0] || hexMatches[0] || DEFAULT_COLORS.green;
    const textOnAccent = relativeLuminance(accent) > 0.5 ? darkest : lightest;
    // Always guaranteed light — used for text over the dark photo-overlay
    // scrim, which is dark by construction regardless of brand palette.
    return { green: accent, cream: lightest, white: textOnAccent, text: darkest, lightText: lightest };
  }

  return {
    green: hexMatches[0] || DEFAULT_COLORS.green,
    cream: hexMatches[1] || DEFAULT_COLORS.cream,
    white: DEFAULT_COLORS.white,
    text: DEFAULT_COLORS.text,
    lightText: DEFAULT_COLORS.white,
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

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

type RenderOptions = {
  // True when this block sits over the photo-overlay scrim — body-ish text
  // needs a guaranteed-light colour instead of the brand's normal (often
  // dark) text colour, since the scrim underneath is always dark.
  onDark?: boolean;
  // True when the layout places the photo itself (photo_overlay, split) —
  // photo_split/photo_single blocks are skipped rather than double-rendered.
  skipPhotoBlocks?: boolean;
};

function renderBlock(
  block: Block,
  key: number,
  photos: PhotoUrls,
  colors: Colors,
  options: RenderOptions = {}
) {
  const bodyColor = options.onDark ? colors.lightText : colors.text;

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
            background: options.onDark ? "rgba(0,0,0,0.4)" : hexToRgba(colors.text, 0.08),
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
            color: bodyColor,
            lineHeight: 1.3,
          }}
        >
          {block.text}
        </div>
      );

    case "body_text":
      return (
        <div key={key} style={{ display: "flex", fontSize: 30, color: bodyColor, lineHeight: 1.4 }}>
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
          <div style={{ display: "flex", fontSize: 24, color: bodyColor }}>{block.label}</div>
        </div>
      );

    case "photo_split": {
      if (options.skipPhotoBlocks) return null;
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
                style={{ display: "flex", width: SPLIT_HALF_WIDTH, height: PHOTO_HEIGHT, objectFit: "cover" }}
              />
              <img
                src={photos.photo_after_url as string}
                style={{ display: "flex", width: SPLIT_HALF_WIDTH, height: PHOTO_HEIGHT, objectFit: "cover" }}
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
      if (options.skipPhotoBlocks) return null;
      const photoUrl = photos.photo_url || photos.photo_after_url;
      return (
        <div key={key} style={{ display: "flex", width: CONTENT_WIDTH, height: PHOTO_HEIGHT }}>
          {photoUrl ? (
            <img
              src={photoUrl}
              style={{ display: "flex", width: CONTENT_WIDTH, height: PHOTO_HEIGHT, objectFit: "cover" }}
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

function buildStackedCanvas(blocks: Block[], photos: PhotoUrls, colors: Colors) {
  return (
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
  );
}

function buildPhotoOverlayCanvas(blocks: Block[], photos: PhotoUrls, colors: Colors, photoUrl: string) {
  const contentBlocks = blocks.filter((b) => b.type !== "photo_split" && b.type !== "photo_single");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: `${CANVAS_WIDTH}px`,
        height: `${CANVAS_WIDTH}px`,
        position: "relative",
        background: colors.cream,
      }}
    >
      <img
        src={photoUrl}
        style={{
          display: "flex",
          position: "absolute",
          top: 0,
          left: 0,
          width: CANVAS_WIDTH,
          height: CANVAS_WIDTH,
          objectFit: "cover",
        }}
      />
      <div
        style={{
          display: "flex",
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "62%",
          background: "linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: `${CANVAS_PADDING}px`,
          gap: "20px",
        }}
      >
        {contentBlocks.map((block, i) => renderBlock(block, i, photos, colors, { onDark: true, skipPhotoBlocks: true }))}
      </div>
    </div>
  );
}

function buildSplitCanvas(blocks: Block[], photos: PhotoUrls, colors: Colors) {
  const contentBlocks = blocks.filter((b) => b.type !== "photo_split" && b.type !== "photo_single");
  const panelWidth = Math.round(CANVAS_WIDTH * 0.44);
  const photoWidth = CANVAS_WIDTH - panelWidth;
  const hasBeforeAfter = photos.photo_before_url && photos.photo_after_url;
  const singlePhotoUrl = photos.photo_url || photos.photo_after_url || photos.photo_before_url;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        width: `${CANVAS_WIDTH}px`,
        height: `${CANVAS_WIDTH}px`,
        background: colors.cream,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: panelWidth,
          height: CANVAS_WIDTH,
          padding: `${CANVAS_PADDING}px`,
          gap: "20px",
        }}
      >
        {contentBlocks.map((block, i) => renderBlock(block, i, photos, colors, { skipPhotoBlocks: true }))}
      </div>
      {hasBeforeAfter ? (
        // A bare <> Fragment as one branch of this ternary caused Satori to
        // only render the first of its two children — wrapping in a real
        // <div> (matching the single-photo branch's own element) fixes it.
        <div style={{ display: "flex", flexDirection: "column", width: photoWidth, height: CANVAS_WIDTH }}>
          <img
            src={photos.photo_before_url as string}
            style={{
              display: "flex",
              width: photoWidth,
              height: CANVAS_WIDTH / 2,
              flexShrink: 0,
              flexGrow: 0,
              objectFit: "cover",
            }}
          />
          <img
            src={photos.photo_after_url as string}
            style={{
              display: "flex",
              width: photoWidth,
              height: CANVAS_WIDTH / 2,
              flexShrink: 0,
              flexGrow: 0,
              objectFit: "cover",
            }}
          />
        </div>
      ) : (
        <img
          src={singlePhotoUrl as string}
          style={{ display: "flex", width: photoWidth, height: CANVAS_WIDTH, objectFit: "cover" }}
        />
      )}
    </div>
  );
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

    // generated_design_notes is repurposed to store the layout key chosen
    // in /api/generate-design. Null (rows generated before this existed)
    // falls back to "stacked", the original single-composition behaviour.
    const overlayPhotoUrl = photos.photo_url || photos.photo_after_url || photos.photo_before_url;
    const hasAnyPhoto = Boolean(overlayPhotoUrl);
    let layout = designRequest.generated_design_notes || "stacked";
    if ((layout === "photo_overlay" || layout === "split") && !hasAnyPhoto) {
      layout = "stacked";
    }

    const canvas =
      layout === "photo_overlay"
        ? buildPhotoOverlayCanvas(blocks, photos, colors, overlayPhotoUrl as string)
        : layout === "split"
        ? buildSplitCanvas(blocks, photos, colors)
        : buildStackedCanvas(blocks, photos, colors);

    const imageResponse = new ImageResponse(canvas, { width: CANVAS_WIDTH, height: CANVAS_WIDTH });

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
