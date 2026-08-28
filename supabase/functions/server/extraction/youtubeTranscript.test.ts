import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractYoutubeVideoId, fetchYoutubeTranscript } from "./youtubeTranscript.ts";

Deno.test("extracts the video id from common YouTube URL shapes", () => {
  assertEquals(extractYoutubeVideoId("https://www.youtube.com/watch?v=abcdefghijk"), "abcdefghijk");
  assertEquals(extractYoutubeVideoId("https://youtu.be/abcdefghijk"), "abcdefghijk");
  assertEquals(extractYoutubeVideoId("https://www.youtube.com/shorts/abcdefghijk"), "abcdefghijk");
  assertEquals(extractYoutubeVideoId("https://example.com/not-youtube"), null);
});

function fakeFetch(listXml: string, trackXml: string): typeof fetch {
  return (async (url: string | URL) => {
    const isListRequest = String(url).includes("type=list");
    return new Response(isListRequest ? listXml : trackXml);
  }) as typeof fetch;
}

Deno.test("fetches and joins transcript lines for the first available language", async () => {
  const listXml = `<transcript_list><track lang_code="en"/></transcript_list>`;
  const trackXml = `<transcript><text>Chop the onion.</text><text>Simmer for 20 minutes.</text></transcript>`;
  const transcript = await fetchYoutubeTranscript("abcdefghijk", fakeFetch(listXml, trackXml));
  assertEquals(transcript, "Chop the onion. Simmer for 20 minutes.");
});

Deno.test("throws when no captions are available", async () => {
  await assertRejects(
    () => fetchYoutubeTranscript("abcdefghijk", fakeFetch("<transcript_list></transcript_list>", "")),
    Error,
    "No captions available",
  );
});
