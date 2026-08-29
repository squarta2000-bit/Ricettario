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
  recordImportAttempt: (userId: string) => Promise<void>;
}

type ImportRequestBody = { type: "url"; url: string } | { type: "text"; text: string };

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
      const body = await c.req.json<ImportRequestBody>();

      let draft: RecipeDraft | null;
      let sourceType: "web" | "youtube" | "text";

      if (body.type === "text") {
        sourceType = "text";
        draft = await extractRecipeWithLlm(body.text, deps.llmClientFactory());
      } else if (body.type === "url") {
        const videoId = extractYoutubeVideoId(body.url);
        sourceType = videoId ? "youtube" : "web";

        if (videoId) {
          const transcript = await deps.fetchYoutubeTranscript(videoId);
          draft = await extractRecipeWithLlm(transcript, deps.llmClientFactory());
        } else {
          const pageResponse = await fetch(body.url);
          if (!pageResponse.ok) throw new Error(`Failed to fetch page: ${pageResponse.status}`);
          const html = await pageResponse.text();
          const jsonLd = findRecipeJsonLd(html);
          draft = jsonLd ? jsonLdToDraft(jsonLd) : null;
          if (!draft) {
            draft = await extractRecipeWithLlm(htmlToVisibleText(html), deps.llmClientFactory());
          }
        }
      } else {
        throw new Error(`Unsupported import type: ${(body as { type: string }).type}`);
      }

      return c.json({ draft, sourceType });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Import failed" }, 502);
    }
  });

  return app;
}
