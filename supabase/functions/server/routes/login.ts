import { Hono } from "npm:hono";

export interface LoginAppDeps {
  findConfirmedUserIdByEmail: (email: string) => Promise<string | null>;
  mintSessionForEmail: (email: string) => Promise<{ accessToken: string; refreshToken: string }>;
}

export function buildLoginApp(deps: LoginAppDeps) {
  const app = new Hono();

  app.post("/server/login", async (c) => {
    try {
      const { email } = await c.req.json<{ email?: unknown }>();
      if (typeof email !== "string" || email.length === 0) {
        return c.json({ error: "Missing email" }, 400);
      }

      const userId = await deps.findConfirmedUserIdByEmail(email);
      if (!userId) {
        return c.json({ error: "No account found for that email. Sign up first." }, 404);
      }

      const { accessToken, refreshToken } = await deps.mintSessionForEmail(email);
      return c.json({ accessToken, refreshToken });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Login failed" }, 502);
    }
  });

  return app;
}
