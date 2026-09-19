import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getValidCanvaAccessToken } from "@/lib/canva/token";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  if (!designRequest.canva_design_id) {
    return NextResponse.json(
      { error: "No Canva design found for this request yet." },
      { status: 400 }
    );
  }

  try {
    const accessToken = await getValidCanvaAccessToken();

    const exportResponse = await fetch("https://api.canva.com/rest/v1/exports", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        design_id: designRequest.canva_design_id,
        format: { type: "png" },
      }),
    });

    const exportData = await exportResponse.json();

    if (!exportResponse.ok) {
      return NextResponse.json(
        { error: `Canva export error: ${exportData.message || JSON.stringify(exportData)}` },
        { status: 500 }
      );
    }

    const jobId = exportData.job.id;

    let downloadUrl: string | null = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      await wait(2000);

      const statusResponse = await fetch(
        `https://api.canva.com/rest/v1/exports/${jobId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      const statusData = await statusResponse.json();

      if (statusData.job?.status === "success" && statusData.job?.urls?.length > 0) {
        downloadUrl = statusData.job.urls[0];
        break;
      }

      if (statusData.job?.status === "failed") {
        return NextResponse.json(
          { error: `Export failed: ${statusData.job.error?.message || "Unknown reason"}` },
          { status: 500 }
        );
      }
    }

    if (!downloadUrl) {
      return NextResponse.json(
        { error: "Export took too long. Please try again." },
        { status: 500 }
      );
    }

    const fileResponse = await fetch(downloadUrl);
    if (!fileResponse.ok) {
      return NextResponse.json(
        { error: "Could not download the exported file from Canva." },
        { status: 500 }
      );
    }

    const fileBuffer = await fileResponse.arrayBuffer();
    const serviceClient = createServiceClient();
    const fileName = `${designRequest.canva_design_id}.png`;

    const { error: uploadError } = await serviceClient.storage
      .from("design-exports")
      .upload(fileName, fileBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Could not save the exported file: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const { data: publicUrlData } = serviceClient.storage
      .from("design-exports")
      .getPublicUrl(fileName);

    const { error: updateError } = await supabase
      .from("design_requests")
      .update({ canva_download_url: publicUrlData.publicUrl })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      download_url: publicUrlData.publicUrl,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
