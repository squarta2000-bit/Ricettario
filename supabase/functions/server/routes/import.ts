import { Hono } from "npm:hono";
import { findRecipeJsonLd, jsonLdToDraft } from "../extraction/jsonld.ts";
import { htmlToVisibleText } from "../extraction/htmlToText.ts";
import { extractRecipeWithLlm, type MessagesClient } from "../extraction/llmExtract.ts";
import { extractYoutubeVideoId } from "../extraction/youtubeTranscript.ts";
import { hasImportCapacity } from "../rateLimit.ts";
import type { RecipeDraft } from "../extraction/types.ts";

export interface ImportAppDeps {
  getUserId: (authHeader: string | undefined) => Promise<string | null>;
  fetchYoutubeTranscript: (videoId: string) => Promise<string>;
  llmClientFactory: () => MessagesClient;
  countRecentImports: (userId: string) => Promise<number>;
}

export function buildImportApp(deps: ImportAppDeps) {
  const app = new Hono();

  app.post("/server/import", async (c) => {
    const userId = await deps.getUserId(c.req.header("Authorization"));
    if (!userId) return c.json({ error: "Unauthorized" }, 401);

    const recentCount = await deps.countRecentImports(userId);
    if (!hasImportCapacity(recentCount)) {
      return c.json({ error: "Daily import limit reached" }, 429);
    }

    const { url } = await c.req.json<{ url: string }>();
    const videoId = extractYoutubeVideoId(url);

    try {
      let draft: RecipeDraft | null;
      const sourceType: "web" | "youtube" = videoId ? "youtube" : "web";

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

      return c.json({ draft, sourceType });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Import failed" }, 502);
    }
  });

  return app;
}
