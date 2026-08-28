import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildImportApp } from "./routes/import.ts";
import { fetchYoutubeTranscript } from "./extraction/youtubeTranscript.ts";
import { createAnthropicMessagesClient } from "./extraction/llmExtract.ts";
import { countRecentImports } from "./rateLimit.ts";

const app = new Hono();

app.use('*', logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

app.get("/server/health", (c) => c.json({ status: "ok" }));

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY")!;

app.route(
  "/",
  buildImportApp({
    getUserId: async (authHeader) => {
      if (!authHeader) return null;
      const supabase = createClient(supabaseUrl, anonKey);
      const { data, error } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (error || !data.user) return null;
      return data.user.id;
    },
    fetchYoutubeTranscript: (videoId) => fetchYoutubeTranscript(videoId, fetch),
    llmClientFactory: () => createAnthropicMessagesClient(anthropicApiKey),
    countRecentImports: (userId) => countRecentImports(supabaseUrl, serviceRoleKey, userId),
  }),
);

Deno.serve(app.fetch);
