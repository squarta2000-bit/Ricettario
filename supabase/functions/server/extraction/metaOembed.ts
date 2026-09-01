export function detectMetaUrl(url: string): { platform: "instagram" | "facebook" } | null {
  if (/^https?:\/\/(www\.)?instagram\.com\//i.test(url)) return { platform: "instagram" };
  if (/^https?:\/\/(www\.)?(facebook\.com|fb\.watch)\//i.test(url)) return { platform: "facebook" };
  return null;
}

// Meta's Graph oEmbed API is the only official, ToS-compliant hook into a
// public Instagram/Facebook post from a server - it returns caption/embed
// metadata, never the video file itself. Requires a registered Meta
// developer app; Meta has historically required App Review for some oEmbed
// scopes in production, which is outside this codebase's control - a
// failure here (private post, unapproved app, no caption) is expected to
// happen sometimes, and the caller falls back to the manual upload path.
export async function fetchMetaCaption(
  url: string,
  platform: "instagram" | "facebook",
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<string> {
  const endpoint = platform === "instagram"
    ? "https://graph.facebook.com/v19.0/instagram_oembed"
    : "https://graph.facebook.com/v19.0/oembed_video";
  const requestUrl = `${endpoint}?url=${encodeURIComponent(url)}&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetchFn(requestUrl);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta oEmbed request failed: ${response.status} ${body}`);
  }
  const data = await response.json();
  const caption = data?.title;
  if (typeof caption !== "string" || caption.trim().length === 0) {
    throw new Error("Post has no caption to extract a recipe from");
  }
  return caption;
}
