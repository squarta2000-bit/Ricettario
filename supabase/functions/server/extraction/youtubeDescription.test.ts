import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchYoutubeVideoInfo } from "./youtubeDescription.ts";

function fakeFetch(status: number, body: unknown): { fetchFn: typeof fetch; getLastUrl: () => string } {
  let lastUrl = "";
  const fetchFn = (async (url: string) => {
    lastUrl = url;
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchFn, getLastUrl: () => lastUrl };
}

Deno.test("extracts title and description from the videos.list response", async () => {
  const { fetchFn } = fakeFetch(200, {
    items: [{ snippet: { title: "Parmigiana di Melanzane", description: "Ingredienti: melanzane, pomodoro..." } }],
  });
  const info = await fetchYoutubeVideoInfo("JYHHt6YUfYo", "fake-key", fetchFn);
  assertEquals(info.title, "Parmigiana di Melanzane");
  assertEquals(info.description, "Ingredienti: melanzane, pomodoro...");
});

Deno.test("requests videos.list with the video id and API key", async () => {
  const { fetchFn, getLastUrl } = fakeFetch(200, {
    items: [{ snippet: { title: "Test", description: "Test description" } }],
  });
  await fetchYoutubeVideoInfo("JYHHt6YUfYo", "my-api-key", fetchFn);
  const url = getLastUrl();
  assertEquals(url.includes("videos?part=snippet"), true);
  assertEquals(url.includes("id=JYHHt6YUfYo"), true);
  assertEquals(url.includes("key=my-api-key"), true);
});

Deno.test("throws when the API request itself fails", async () => {
  const { fetchFn } = fakeFetch(403, { error: { message: "quota exceeded" } });
  await assertRejects(
    () => fetchYoutubeVideoInfo("abc", "fake-key", fetchFn),
    Error,
    "YouTube Data API request failed",
  );
});

Deno.test("throws when there is no matching video item", async () => {
  const { fetchFn } = fakeFetch(200, { items: [] });
  await assertRejects(
    () => fetchYoutubeVideoInfo("abc", "fake-key", fetchFn),
    Error,
    "Video has no description",
  );
});

Deno.test("throws when the snippet has no description", async () => {
  const { fetchFn } = fakeFetch(200, { items: [{ snippet: { title: "Test" } }] });
  await assertRejects(
    () => fetchYoutubeVideoInfo("abc", "fake-key", fetchFn),
    Error,
    "Video has no description",
  );
});
