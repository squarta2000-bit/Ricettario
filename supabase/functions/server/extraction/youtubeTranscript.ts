export function extractYoutubeVideoId(url: string): string | null {
  const patterns = [
    /youtube\.com\/watch\?v=([\w-]{11})/,
    /youtu\.be\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(url);
    if (match) return match[1];
  }
  return null;
}

export async function fetchYoutubeTranscript(videoId: string, fetchFn: typeof fetch): Promise<string> {
  const listResponse = await fetchFn(`https://video.google.com/timedtext?type=list&v=${videoId}`);
  const listXml = await listResponse.text();
  const langMatch = /lang_code="([^"]+)"/.exec(listXml);
  if (!langMatch) throw new Error("No captions available for this video");

  const trackResponse = await fetchFn(`https://video.google.com/timedtext?lang=${langMatch[1]}&v=${videoId}`);
  const trackXml = await trackResponse.text();
  const lines = [...trackXml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
    m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').trim()
  );
  if (lines.length === 0) throw new Error("Transcript was empty");
  return lines.join(" ");
}
