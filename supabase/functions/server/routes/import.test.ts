import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildImportApp } from "./import.ts";
import type { MessagesClient } from "../extraction/llmExtract.ts";

function fakeLlmClient(draftJson: Record<string, unknown>): MessagesClient {
  return { messages: { create: async () => ({ content: [{ type: "text", text: JSON.stringify(draftJson) }] }) } };
}

async function withFixtureServer(html: string, run: (url: string) => Promise<void>) {
  const server = Deno.serve({ port: 0 }, () => new Response(html, { headers: { "content-type": "text/html" } }));
  const port = (server.addr as Deno.NetAddr).port;
  try {
    await run(`http://localhost:${port}/`);
  } finally {
    await server.shutdown();
  }
}

const JSONLD_HTML = `<script type="application/ld+json">{"@type":"Recipe","name":"Soup","recipeIngredient":["Tomatoes"],"recipeInstructions":["Simmer."]}</script>`;
const PLAIN_HTML = `<html><body><h1>Soup</h1><p>Simmer the tomatoes for ten minutes.</p></body></html>`;

Deno.test("returns 401 when there is no Authorization header", async () => {
  const app = buildImportApp({
    getUserId: async () => null,
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    body: JSON.stringify({ type: "url", url: "https://x.test" }),
  });
  assertEquals(response.status, 401);
});

Deno.test("returns 429 when the daily import limit is reached, without recording another attempt", async () => {
  let attemptRecorded = false;
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 20,
    recordImportAttempt: async () => {
      attemptRecorded = true;
    },
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://x.test" }),
  });
  assertEquals(response.status, 429);
  assertEquals(attemptRecorded, false);
});

Deno.test("records an import attempt for every accepted request, regardless of outcome", async () => {
  let recordedForUserId: string | null = null;
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async (userId) => {
      recordedForUserId = userId;
    },
  });
  // A URL fetch failure still counts as an attempt - the point of this limit
  // is to bound how many times a user can trigger this route, not just the
  // ones that happen to succeed.
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://nonexistent.invalid/recipe" }),
  });
  assertEquals(response.status, 502);
  assertEquals(recordedForUserId, "user-1");
});

Deno.test("merges JSON-LD's structure with the LLM's complexity, calling the LLM even when JSON-LD is present", async () => {
  await withFixtureServer(JSONLD_HTML, async (url) => {
    let llmCalled = false;
    const app = buildImportApp({
      getUserId: async () => "user-1",
      fetchYoutubeTranscript: async () => "",
      fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
      fetchMetaCaption: async () => "",
      llmClientFactory: () => {
        llmCalled = true;
        return fakeLlmClient({
          title: "LLM's own guess, should be ignored",
          complexity: "Facile",
          servings: null,
          ingredients: [],
          steps: [],
        });
      },
      countRecentImports: async () => 0,
      recordImportAttempt: async () => {},
    });
    const response = await app.request("/server/import", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ type: "url", url }),
    });
    const body = await response.json();
    assertEquals(response.status, 200);
    // JSON-LD's title/ingredients win...
    assertEquals(body.draft.title, "Soup");
    assertEquals(body.draft.ingredients.length, 1);
    // ...but complexity - which JSON-LD never has - comes from the LLM.
    assertEquals(body.draft.complexity, "Facile");
    assertEquals(llmCalled, true);
  });
});

Deno.test("falls back to the LLM when there is no JSON-LD", async () => {
  await withFixtureServer(PLAIN_HTML, async (url) => {
    const app = buildImportApp({
      getUserId: async () => "user-1",
      fetchYoutubeTranscript: async () => "",
      fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
      fetchMetaCaption: async () => "",
      llmClientFactory: () =>
        fakeLlmClient({ title: "Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
      countRecentImports: async () => 0,
      recordImportAttempt: async () => {},
    });
    const response = await app.request("/server/import", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ type: "url", url }),
    });
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.draft.title, "Soup");
  });
});

Deno.test("routes YouTube URLs through the transcript path", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "Chop onions. Simmer for ten minutes.",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () =>
      fakeLlmClient({ title: "Video Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://youtu.be/abcdefghijk" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "youtube");
  assertEquals(body.draft.title, "Video Soup");
});

Deno.test("falls back to the video's title/description when transcript fetching fails", async () => {
  let capturedSourceText = "";
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => {
      throw new Error("No captions available for this video");
    },
    fetchYoutubeVideoInfo: async () => ({
      title: "Parmigiana di Melanzane",
      description: "INGREDIENTI\nMelanzane 1,7 kg\nPassata di pomodoro 1 l",
    }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => ({
      messages: {
        create: async (params) => {
          capturedSourceText = (params.messages as Array<{ content: string }>)[0].content;
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  title: "Parmigiana di Melanzane",
                  complexity: null,
                  servings: null,
                  ingredients: [],
                  steps: [],
                }),
              },
            ],
          };
        },
      },
    }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://youtu.be/abcdefghijk" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "youtube");
  assertEquals(body.draft.title, "Parmigiana di Melanzane");
  // The fallback's title+description both made it into the text sent to the LLM.
  if (!capturedSourceText.includes("Parmigiana di Melanzane") || !capturedSourceText.includes("Passata di pomodoro")) {
    throw new Error(`Expected the fallback title+description in the LLM prompt, got: ${capturedSourceText}`);
  }
});

Deno.test("extracts a recipe from pasted text via the LLM, skipping the URL/transcript path", async () => {
  let transcriptFetched = false;
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => {
      transcriptFetched = true;
      return "";
    },
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () =>
      fakeLlmClient({ title: "Text Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "text", text: "Chop onions. Simmer for ten minutes." }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "text");
  assertEquals(body.draft.title, "Text Soup");
  assertEquals(transcriptFetched, false);
});

Deno.test("returns 400 with a descriptive message for an unrecognized import type", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "bogus" }),
  });
  const body = await response.json();
  assertEquals(response.status, 400);
  assertEquals(body.error, "Unsupported import type: bogus");
});

Deno.test("treats a bare { url } body with no type field as a URL import", async () => {
  await withFixtureServer(JSONLD_HTML, async (url) => {
    const app = buildImportApp({
      getUserId: async () => "user-1",
      fetchYoutubeTranscript: async () => "",
      fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
      fetchMetaCaption: async () => "",
      llmClientFactory: () => fakeLlmClient({}),
      countRecentImports: async () => 0,
      recordImportAttempt: async () => {},
    });
    const response = await app.request("/server/import", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
      body: JSON.stringify({ url }),
    });
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.sourceType, "web");
    assertEquals(body.draft.title, "Soup");
  });
});

Deno.test("returns 400 for type: text with a missing text field", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "text" }),
  });
  assertEquals(response.status, 400);
});

Deno.test("returns 400 for type: url with a missing url field", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url" }),
  });
  assertEquals(response.status, 400);
});

Deno.test("returns 400 for type: images with a missing images field", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images" }),
  });
  assertEquals(response.status, 400);
});

Deno.test("returns 400 for type: images with images not an array", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images", images: "not-an-array" }),
  });
  assertEquals(response.status, 400);
});

Deno.test("returns 400 for a body with no type and no url", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({}),
  });
  assertEquals(response.status, 400);
});

Deno.test("extracts a recipe from photos via the LLM vision call", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () =>
      fakeLlmClient({ title: "Photo Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images", images: [{ mediaType: "image/jpeg", data: "aaa" }] }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "photo");
  assertEquals(body.draft.title, "Photo Soup");
});

Deno.test("rejects an images request with no photos", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images", images: [] }),
  });
  assertEquals(response.status, 400);
});

Deno.test("rejects an images request with more than 5 photos", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => "",
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const sixImages = Array.from({ length: 6 }, () => ({ mediaType: "image/jpeg", data: "aaa" }));
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "images", images: sixImages }),
  });
  assertEquals(response.status, 400);
});

Deno.test("routes Instagram URLs through the Meta caption path", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async (_url, platform) => {
      assertEquals(platform, "instagram");
      return "1kg flour, 500ml water. Mix and bake.";
    },
    llmClientFactory: () =>
      fakeLlmClient({ title: "Reel Bread", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.instagram.com/reel/abc123/" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "instagram");
  assertEquals(body.draft.title, "Reel Bread");
});

Deno.test("routes Facebook URLs through the Meta caption path", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async (_url, platform) => {
      assertEquals(platform, "facebook");
      return "Chop onions. Simmer for ten minutes.";
    },
    llmClientFactory: () =>
      fakeLlmClient({ title: "Reel Soup", complexity: null, servings: null, ingredients: [], steps: [] }),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.facebook.com/reel/123456" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.sourceType, "facebook");
  assertEquals(body.draft.title, "Reel Soup");
});

Deno.test("falls back to the generic error path when Meta caption fetching fails", async () => {
  const app = buildImportApp({
    getUserId: async () => "user-1",
    fetchYoutubeTranscript: async () => "",
    fetchYoutubeVideoInfo: async () => ({ title: "", description: "" }),
    fetchMetaCaption: async () => {
      throw new Error("Post has no caption to extract a recipe from");
    },
    llmClientFactory: () => fakeLlmClient({}),
    countRecentImports: async () => 0,
    recordImportAttempt: async () => {},
  });
  const response = await app.request("/server/import", {
    method: "POST",
    headers: { Authorization: "Bearer token" },
    body: JSON.stringify({ type: "url", url: "https://www.instagram.com/reel/abc123/" }),
  });
  assertEquals(response.status, 502);
});
