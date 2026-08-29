export interface YoutubeVideoInfo {
  title: string;
  description: string;
}

// Falls back to the video's title/description when the transcript can't be
// fetched. Uses the official YouTube Data API v3 (a plain API key, no OAuth)
// rather than scraping the watch page - scraping gets an explicit
// "LOGIN_REQUIRED / Sign in to confirm you're not a bot" bot-check from
// unauthenticated server-side requests, which no amount of headers/cookies
// reliably works around. Many recipe channels put the full written recipe
// in the description anyway.
export async function fetchYoutubeVideoInfo(
  videoId: string,
  apiKey: string,
  fetchFn: typeof fetch,
): Promise<YoutubeVideoInfo> {
  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
  const response = await fetchFn(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube Data API request failed: ${response.status} ${body}`);
  }

  const data = await response.json();
  const snippet = data?.items?.[0]?.snippet;
  const title = snippet?.title;
  const description = snippet?.description;
  if (!title || !description) throw new Error("Video has no description to fall back on");

  return { title, description };
}
