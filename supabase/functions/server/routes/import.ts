import { Hono } from "npm:hono";
import { findRecipeJsonLd, jsonLdToDraft } from "../extraction/jsonld.ts";
import { htmlToVisibleText } from "../extraction/htmlToText.ts";
import { extractRecipeWithLlm, type MessagesClient } from "../extraction/llmExtract.ts";
import { extractRecipeFromImages, type ImageInput } from "../extraction/llmExtractImages.ts";
import { extractYoutubeVideoId } from "../extraction/youtubeTranscript.ts";
import { hasImportCapacity } from "../rateLimit.ts";
import type { RecipeDraft } from "../extraction/types.ts";

export interface ImportAppDeps {
  getUserId: (authHeader: string | undefined) => Promise<string | null>;
  fetchYoutubeTranscript: (videoId: string) => Promise<string>;
  llmClientFactory: () => MessagesClient;
  countRecentImports: (userId: string) => Promise<number>;
  recordImportAttempt: (userId: string) => Promise<void>;
}

const MAX_IMAGES = 5;

export function buildImportApp(deps: ImportAppDeps) {
  const app = new Hono();

  app.post("/server/import", async (c) => {
    const userId = await deps.getUserId(c.req.header("Authorization"));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const recentCount = await deps.countRecentImports(userId);
    if (!hasImportCapacity(recentCount)) {
      return c.json({ error: "Daily import limit reached" }, 429);
    }

    // Record the attempt now, before any network/LLM work — the limit bounds
    // attempts (which is what actually costs money), not saved recipes.
    await deps.recordImportAttempt(userId);

    try {
      const rawBody = await c.req.json<Record<string, unknown>>();
      const type = typeof rawBody?.type === "string"
        ? rawBody.type
        : typeof rawBody?.url === "string"
          ? "url"
          : undefined;

      let draft: RecipeDraft | null;
      let sourceType: "web" | "youtube" | "text" | "photo";

      if (type === "text") {
        if (typeof rawBody.text !== "string") return c.json({ error: "Missing text" }, 400);
        sourceType = "text";
        draft = await extractRecipeWithLlm(rawBody.text, deps.llmClientFactory());
      } else if (type === "images") {
        if (!Array.isArray(rawBody.images) || rawBody.images.length === 0 || rawBody.images.length > MAX_IMAGES) {
          return c.json({ error: `Provide between 1 and ${MAX_IMAGES} photos` }, 400);
        }
        sourceType = "photo";
        draft = await extractRecipeFromImages(rawBody.images as ImageInput[], deps.llmClientFactory());
      } else if (type === "url") {
        if (typeof rawBody.url !== "string") return c.json({ error: "Missing url" }, 400);
        const url = rawBody.url;
        const videoId = extractYoutubeVideoId(url);
        sourceType = videoId ? "youtube" : "web";

        if (videoId) {
          const transcript = await deps.fetchYoutubeTranscript(videoId);
          draft = await extractRecipeWithLlm(transcript, deps.llmClientFactory());
        } else {
          const pageResponse = await fetch(url);
          if (!pageResponse.ok) throw new Error(`Failed to fetch page: ${pageResponse.status}`);
          const html = await pageResponse.text();
          const jsonLd = findRecipeJsonLd(html);
          draft = jsonLd ? jsonLdToDraft(jsonLd) : null;
          if (!draft) {
            draft = await extractRecipeWithLlm(htmlToVisibleText(html), deps.llmClientFactory());
          }
        }
      } else {
        return c.json({ error: `Unsupported import type: ${String(type)}` }, 400);
      }

      return c.json({ draft, sourceType });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Import failed" }, 502);
    }
  });

  return app;
}
