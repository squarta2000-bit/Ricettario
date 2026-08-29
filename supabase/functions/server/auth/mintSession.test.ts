import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { mintSessionForEmail, type AdminAuthClient } from "./mintSession.ts";

function fakeAdminClient(actionLink: string | null, errorMessage: string | null = null): AdminAuthClient {
  return {
    auth: {
      admin: {
        generateLink: async () => ({
          data: actionLink ? { properties: { action_link: actionLink } } : null,
          error: errorMessage ? { message: errorMessage } : null,
        }),
      },
    },
  };
}

function fakeFetch(response: Response): typeof fetch {
  return (async () => response) as unknown as typeof fetch;
}

Deno.test("returns access and refresh tokens parsed from the verification redirect", async () => {
  const client = fakeAdminClient("https://example.test/verify?token=abc");
  const location =
    "http://localhost:5199/#access_token=at-123&refresh_token=rt-456&expires_in=3600&token_type=bearer";
  const fetchImpl = fakeFetch(new Response(null, { status: 303, headers: { location } }));

  const result = await mintSessionForEmail("user@example.com", client, fetchImpl);

  assertEquals(result.accessToken, "at-123");
  assertEquals(result.refreshToken, "rt-456");
});

Deno.test("throws when generateLink returns an error", async () => {
  const client = fakeAdminClient(null, "boom");
  await assertRejects(
    () => mintSessionForEmail("user@example.com", client, fakeFetch(new Response())),
    Error,
    "boom",
  );
});

Deno.test("throws when generateLink returns no action_link", async () => {
  const client = fakeAdminClient(null);
  await assertRejects(
    () => mintSessionForEmail("user@example.com", client, fakeFetch(new Response())),
    Error,
    "Failed to generate a session link",
  );
});

Deno.test("throws when the verify response has no location header", async () => {
  const client = fakeAdminClient("https://example.test/verify?token=abc");
  const fetchImpl = fakeFetch(new Response(null, { status: 200 }));
  await assertRejects(
    () => mintSessionForEmail("user@example.com", client, fetchImpl),
    Error,
    "Verification did not return a redirect",
  );
});

Deno.test("throws when the redirect fragment has no tokens", async () => {
  const client = fakeAdminClient("https://example.test/verify?token=abc");
  const fetchImpl = fakeFetch(
    new Response(null, { status: 303, headers: { location: "http://localhost:5199/#error=access_denied" } }),
  );
  await assertRejects(
    () => mintSessionForEmail("user@example.com", client, fetchImpl),
    Error,
    "No session tokens in verification redirect",
  );
});
