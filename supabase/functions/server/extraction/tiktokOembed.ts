// TikTok's oEmbed endpoint is public and unauthenticated - no developer
// app, no access token, no App Review, unlike Meta's equivalent (see
// docs/superpowers/specs/2026-09-05-tiktok-import-design.md). Confirmed
// live during the spike that predates this file: a request without a
// browser-like User-Agent can be blocked by TikTok's WAF, while one with
// a standard browser UA string succeeds - always send this header.
export function detectTiktokUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(tiktok\.com|vm\.tiktok\.com)\//i.test(url);
}

export async function fetchTiktokCaption(url: string, fetchFn: typeof fetch): Promise<string> {
  const requestUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  const response = await fetchFn(requestUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TikTok oEmbed request failed: ${response.status} ${body}`);
  }
  const data = await response.json();
  const caption = data?.title;
  if (typeof caption !== "string" || caption.trim().length === 0) {
    throw new Error("Post has no caption to extract a recipe from");
  }
  return caption;
}
