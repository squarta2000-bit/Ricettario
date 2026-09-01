import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildImportApp } from "./routes/import.ts";
import { buildLoginApp } from "./routes/login.ts";
import { fetchYoutubeTranscript } from "./extraction/youtubeTranscript.ts";
import { fetchYoutubeVideoInfo } from "./extraction/youtubeDescription.ts";
import { fetchMetaCaption } from "./extraction/metaOembed.ts";
import { createAnthropicMessagesClient } from "./extraction/llmExtract.ts";
import { mintSessionForEmail } from "./auth/mintSession.ts";
import { countRecentImports, recordImportAttempt } from "./rateLimit.ts";
import { findConfirmedUserIdByEmail } from "./userLookup.ts";

const app = new Hono();

app.use('*', logger(console.log));
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "x-client-info", "apikey"],
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
const youtubeApiKey = Deno.env.get("YOUTUBE_API_KEY")!;
const metaAppId = Deno.env.get("META_APP_ID")!;
const metaClientToken = Deno.env.get("META_CLIENT_TOKEN")!;

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
    fetchYoutubeVideoInfo: (videoId) => fetchYoutubeVideoInfo(videoId, youtubeApiKey, fetch),
    fetchMetaCaption: (url, platform) => fetchMetaCaption(url, platform, `${metaAppId}|${metaClientToken}`, fetch),
    llmClientFactory: () => createAnthropicMessagesClient(anthropicApiKey),
    countRecentImports: (userId) => countRecentImports(supabaseUrl, serviceRoleKey, userId),
    recordImportAttempt: (userId) => recordImportAttempt(supabaseUrl, serviceRoleKey, userId),
  }),
);

app.route(
  "/",
  buildLoginApp({
    findConfirmedUserIdByEmail: (email) => findConfirmedUserIdByEmail(supabaseUrl, serviceRoleKey, email),
    mintSessionForEmail: (email) =>
      mintSessionForEmail(email, createClient(supabaseUrl, serviceRoleKey), fetch),
  }),
);

Deno.serve(app.fetch);
