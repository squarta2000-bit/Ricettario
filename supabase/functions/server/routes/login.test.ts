import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildLoginApp } from "./login.ts";

Deno.test("returns 400 when email is missing", async () => {
  const app = buildLoginApp({
    findConfirmedUserIdByEmail: async () => "user-1",
    mintSessionForEmail: async () => ({ accessToken: "at", refreshToken: "rt" }),
  });
  const response = await app.request("/server/login", { method: "POST", body: JSON.stringify({}) });
  assertEquals(response.status, 400);
});

Deno.test("returns 404 when no confirmed user exists for that email, without minting a session", async () => {
  let sessionMinted = false;
  const app = buildLoginApp({
    findConfirmedUserIdByEmail: async () => null,
    mintSessionForEmail: async () => {
      sessionMinted = true;
      return { accessToken: "at", refreshToken: "rt" };
    },
  });
  const response = await app.request("/server/login", {
    method: "POST",
    body: JSON.stringify({ email: "nobody@example.com" }),
  });
  assertEquals(response.status, 404);
  assertEquals(sessionMinted, false);
});

Deno.test("returns session tokens when a confirmed user exists", async () => {
  const app = buildLoginApp({
    findConfirmedUserIdByEmail: async (email) => (email === "user@example.com" ? "user-1" : null),
    mintSessionForEmail: async () => ({ accessToken: "at-123", refreshToken: "rt-456" }),
  });
  const response = await app.request("/server/login", {
    method: "POST",
    body: JSON.stringify({ email: "user@example.com" }),
  });
  const body = await response.json();
  assertEquals(response.status, 200);
  assertEquals(body.accessToken, "at-123");
  assertEquals(body.refreshToken, "rt-456");
});

Deno.test("returns 502 when minting a session fails", async () => {
  const app = buildLoginApp({
    findConfirmedUserIdByEmail: async () => "user-1",
    mintSessionForEmail: async () => {
      throw new Error("mint failed");
    },
  });
  const response = await app.request("/server/login", {
    method: "POST",
    body: JSON.stringify({ email: "user@example.com" }),
  });
  const body = await response.json();
  assertEquals(response.status, 502);
  assertEquals(body.error, "mint failed");
});
