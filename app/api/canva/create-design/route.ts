import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getValidCanvaAccessToken } from "@/lib/canva/token";

// Verified against the connected Canva account's real design list — the
// previous "Before & After" id (DAHUyMnViKI) was a guess made before Canva
// was ever connected and didn't exist. Replaced with the real
// "BRAND — Social — Before & After" template.
const templateMap: Record<string, string> = {
  "Before & After": "DAHT4XnKvXM",
  "Showroom": "DAHUyAaVGTo",
  "Promotional": "DAHUyE2L7RM",
};

async function getGeneratedDesignsFolderId(accessToken: string): Promise<string> {
  const serviceClient = createServiceClient();

  const { data: settings } = await serviceClient
    .from("canva_settings")
    .select("generated_designs_folder_id")
    .limit(1)
    .maybeSingle();

  if (settings?.generated_designs_folder_id) {
    return settings.generated_designs_folder_id;
  }

  const folderResponse = await fetch("https://api.canva.com/rest/v1/folders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Generated Designs",
      parent_folder_id: "root",
    }),
  });

  const folderData = await folderResponse.json();

  if (!folderResponse.ok) {
    throw new Error(
      `Could not create Canva folder: ${folderData.message || JSON.stringify(folderData)}`
    );
  }

  const folderId = folderData.folder.id;

  await serviceClient
    .from("canva_settings")
    .insert({ generated_designs_folder_id: folderId });

  return folderId;
}

async function getServiceLineFolderId(
  accessToken: string,
  serviceLine: string,
  parentFolderId: string
): Promise<string> {
  const serviceClient = createServiceClient();

  const { data: existing } = await serviceClient
    .from("canva_service_folders")
    .select("folder_id")
    .eq("service_line", serviceLine)
    .maybeSingle();

  if (existing?.folder_id) {
    return existing.folder_id;
  }

  const folderResponse = await fetch("https://api.canva.com/rest/v1/folders", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: serviceLine,
      parent_folder_id: parentFolderId,
    }),
  });

  const folderData = await folderResponse.json();

  if (!folderResponse.ok) {
    throw new Error(
      `Could not create service line folder: ${folderData.message || JSON.stringify(folderData)}`
    );
  }

  const folderId = folderData.folder.id;

  await serviceClient
    .from("canva_service_folders")
    .insert({ service_line: serviceLine, folder_id: folderId });

  return folderId;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForThumbnail(
  designId: string,
  accessToken: string
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await wait(2000);

    const res = await fetch(`https://api.canva.com/rest/v1/designs/${designId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!res.ok) continue;

    const data = await res.json();

    if (data.design?.thumbnail?.url) {
      return data.design.thumbnail.url;
    }
  }

  return null;
}

async function saveThumbnailPermanently(
  thumbnailUrl: string,
  designId: string
): Promise<string | null> {
  try {
    const imageResponse = await fetch(thumbnailUrl);
    if (!imageResponse.ok) return null;

    const imageBuffer = await imageResponse.arrayBuffer();
    const serviceClient = createServiceClient();

    const fileName = `${designId}.jpg`;

    const { error: uploadError } = await serviceClient.storage
      .from("design-previews")
      .upload(fileName, imageBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) {
      console.error("Thumbnail upload failed:", uploadError);
      return null;
    }

    const { data: publicUrlData } = serviceClient.storage
      .from("design-previews")
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error("Thumbnail save failed:", err);
    return null;
  }
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

  const templateId = templateMap[designRequest.design_type];

  if (!templateId) {
    return NextResponse.json(
      {
        error: `No Canva template set up yet for "${designRequest.design_type}". Available: ${Object.keys(templateMap).join(", ")}`,
      },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getValidCanvaAccessToken();

    const canvaResponse = await fetch("https://api.canva.com/rest/v1/designs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "design",
        design_id: templateId,
      }),
    });

    const canvaData = await canvaResponse.json();

    if (!canvaResponse.ok) {
      return NextResponse.json(
        { error: `Canva API error: ${canvaData.message || JSON.stringify(canvaData)}` },
        { status: 500 }
      );
    }

    const designId = canvaData.design.id;

    try {
      const parentFolderId = await getGeneratedDesignsFolderId(accessToken);
      const serviceFolderId = await getServiceLineFolderId(
        accessToken,
        designRequest.service_line,
        parentFolderId
      );

      await fetch("https://api.canva.com/rest/v1/folders/move", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to_folder_id: serviceFolderId,
          item_id: designId,
        }),
      });
    } catch (folderErr) {
      console.error("Folder organization failed (non-blocking):", folderErr);
    }

    let permanentThumbnailUrl: string | null = null;
    try {
      const thumbnailUrl =
        canvaData.design.thumbnail?.url ||
        (await waitForThumbnail(designId, accessToken));

      if (thumbnailUrl) {
        permanentThumbnailUrl = await saveThumbnailPermanently(thumbnailUrl, designId);
      }
    } catch (thumbErr) {
      console.error("Thumbnail step failed (non-blocking):", thumbErr);
    }

    const standardEditUrl = `https://www.canva.com/design/${designId}/edit`;
    const standardViewUrl = `https://www.canva.com/design/${designId}/view`;

    const { error: updateError } = await supabase
      .from("design_requests")
      .update({
        canva_design_id: designId,
        canva_design_url: standardViewUrl,
        canva_edit_url: standardEditUrl,
        canva_thumbnail_url: permanentThumbnailUrl,
      })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      edit_url: standardEditUrl,
      view_url: standardViewUrl,
      thumbnail_url: permanentThumbnailUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
