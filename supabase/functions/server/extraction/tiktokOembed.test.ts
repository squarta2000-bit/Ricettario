import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectTiktokUrl, fetchTiktokCaption } from "./tiktokOembed.ts";

function fakeFetch(
  status: number,
  body: unknown,
): { fetchFn: typeof fetch; getLastCall: () => { url: string; headers: Record<string, string> } } {
  let lastUrl = "";
  let lastHeaders: Record<string, string> = {};
  const fetchFn = (async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastHeaders = (init?.headers as Record<string, string>) ?? {};
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, getLastCall: () => ({ url: lastUrl, headers: lastHeaders }) };
}

Deno.test("detects tiktok.com URLs", () => {
  assertEquals(detectTiktokUrl("https://www.tiktok.com/@cookist/video/7644494880604982550"), true);
  assertEquals(detectTiktokUrl("https://tiktok.com/@user/video/123"), true);
});

Deno.test("detects vm.tiktok.com short links", () => {
  assertEquals(detectTiktokUrl("https://vm.tiktok.com/ABC123/"), true);
});

Deno.test("returns false for unrelated URLs", () => {
  assertEquals(detectTiktokUrl("https://example.com/recipe"), false);
  assertEquals(detectTiktokUrl("https://youtu.be/abcdefghijk"), false);
});

Deno.test("extracts the caption from a successful oEmbed response", async () => {
  const { fetchFn } = fakeFetch(200, { title: "1kg flour, 500ml water. Mix and bake." });
  const caption = await fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn);
  assertEquals(caption, "1kg flour, 500ml water. Mix and bake.");
});

Deno.test("requests the TikTok oEmbed endpoint with the url and a browser User-Agent header", async () => {
  const { fetchFn, getLastCall } = fakeFetch(200, { title: "Recipe text" });
  await fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn);
  const { url, headers } = getLastCall();
  assertEquals(url.includes("www.tiktok.com/oembed"), true);
  assertEquals(url.includes("url=https%3A%2F%2Fwww.tiktok.com%2F%40user%2Fvideo%2F123"), true);
  assertEquals(headers["User-Agent"].includes("Mozilla"), true);
});

Deno.test("throws when the oEmbed request itself fails", async () => {
  const { fetchFn } = fakeFetch(400, { message: "Something went wrong", code: 400 });
  await assertRejects(
    () => fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn),
    Error,
    "TikTok oEmbed request failed",
  );
});

Deno.test("throws when the response has no caption", async () => {
  const { fetchFn } = fakeFetch(200, { title: "" });
  await assertRejects(
    () => fetchTiktokCaption("https://www.tiktok.com/@user/video/123", fetchFn),
    Error,
    "Post has no caption",
  );
});
