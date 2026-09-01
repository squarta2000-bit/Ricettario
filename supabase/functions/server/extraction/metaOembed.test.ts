import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectMetaUrl, fetchMetaCaption } from "./metaOembed.ts";

function fakeFetch(status: number, body: unknown): { fetchFn: typeof fetch; getLastUrl: () => string } {
  let lastUrl = "";
  const fetchFn = (async (url: string) => {
    lastUrl = url;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, getLastUrl: () => lastUrl };
}

Deno.test("detects Instagram URLs", () => {
  assertEquals(detectMetaUrl("https://www.instagram.com/reel/abc123/"), { platform: "instagram" });
  assertEquals(detectMetaUrl("https://instagram.com/p/abc123/"), { platform: "instagram" });
});

Deno.test("detects Facebook URLs, including fb.watch short links", () => {
  assertEquals(detectMetaUrl("https://www.facebook.com/reel/123456"), { platform: "facebook" });
  assertEquals(detectMetaUrl("https://fb.watch/abc123/"), { platform: "facebook" });
});

Deno.test("returns null for unrelated URLs", () => {
  assertEquals(detectMetaUrl("https://example.com/recipe"), null);
  assertEquals(detectMetaUrl("https://youtu.be/abcdefghijk"), null);
});

Deno.test("extracts the caption from a successful oEmbed response", async () => {
  const { fetchFn } = fakeFetch(200, { title: "1kg flour, 500ml water. Mix and bake." });
  const caption = await fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "token", fetchFn);
  assertEquals(caption, "1kg flour, 500ml water. Mix and bake.");
});

Deno.test("requests the Instagram oEmbed endpoint with the url and access token", async () => {
  const { fetchFn, getLastUrl } = fakeFetch(200, { title: "Recipe text" });
  await fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "app-id|client-token", fetchFn);
  const url = getLastUrl();
  assertEquals(url.includes("graph.facebook.com/v19.0/instagram_oembed"), true);
  assertEquals(url.includes("access_token=app-id%7Cclient-token"), true);
});

Deno.test("requests the Facebook oEmbed endpoint for Facebook URLs", async () => {
  const { fetchFn, getLastUrl } = fakeFetch(200, { title: "Recipe text" });
  await fetchMetaCaption("https://www.facebook.com/reel/123456", "facebook", "token", fetchFn);
  assertEquals(getLastUrl().includes("graph.facebook.com/v19.0/oembed_video"), true);
});

Deno.test("throws when the oEmbed request itself fails", async () => {
  const { fetchFn } = fakeFetch(400, { error: { message: "Invalid access token" } });
  await assertRejects(
    () => fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "bad-token", fetchFn),
    Error,
    "Meta oEmbed request failed",
  );
});

Deno.test("throws when the response has no caption", async () => {
  const { fetchFn } = fakeFetch(200, { title: "" });
  await assertRejects(
    () => fetchMetaCaption("https://www.instagram.com/reel/abc123/", "instagram", "token", fetchFn),
    Error,
    "Post has no caption",
  );
});
