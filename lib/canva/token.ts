import { createServiceClient } from "@/lib/supabase/service";

export async function getValidCanvaAccessToken(): Promise<string> {
  const supabase = createServiceClient();

  const { data: tokenRow, error } = await supabase
    .from("canva_tokens")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !tokenRow) {
    throw new Error("No Canva connection found. Please connect Canva in Settings.");
  }

  const expiresAt = new Date(tokenRow.expires_at).getTime();
  const now = Date.now();

  if (now < expiresAt - 60000) {
    return tokenRow.access_token;
  }

  const basicAuth = Buffer.from(
    `${process.env.CANVA_CLIENT_ID}:${process.env.CANVA_CLIENT_SECRET}`
  ).toString("base64");

  const refreshResponse = await fetch(
    "https://api.canva.com/rest/v1/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokenRow.refresh_token,
      }),
    }
  );

  const refreshData = await refreshResponse.json();

  if (!refreshResponse.ok) {
    throw new Error(
      `Failed to refresh Canva token: ${refreshData.error_description || refreshData.error}`
    );
  }

  const newExpiresAt = new Date(
    Date.now() + refreshData.expires_in * 1000
  ).toISOString();

  await supabase.from("canva_tokens").insert({
    access_token: refreshData.access_token,
    refresh_token: refreshData.refresh_token || tokenRow.refresh_token,
    expires_at: newExpiresAt,
  });

  return refreshData.access_token;
}
