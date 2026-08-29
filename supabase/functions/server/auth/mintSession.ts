export interface AdminAuthClient {
  auth: {
    admin: {
      generateLink(params: { type: "magiclink"; email: string }): Promise<{
        data: { properties?: { action_link?: string | null } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export interface MintedSession {
  accessToken: string;
  refreshToken: string;
}

// Mints a real session for an already-confirmed user without sending them
// any email. `generateLink` (admin-only, no email sent) produces the same
// verification token a real magic-link email would carry; fetching that
// link ourselves with a manual redirect surfaces the session tokens
// Supabase's Auth server appends to the redirect URL fragment, the same way
// a browser following a real magic link would receive them.
export async function mintSessionForEmail(
  email: string,
  adminClient: AdminAuthClient,
  fetchImpl: typeof fetch,
): Promise<MintedSession> {
  const { data, error } = await adminClient.auth.admin.generateLink({ type: "magiclink", email });
  const actionLink = data?.properties?.action_link;
  if (error || !actionLink) {
    throw new Error(error?.message ?? "Failed to generate a session link");
  }

  const response = await fetchImpl(actionLink, { redirect: "manual" });
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Verification did not return a redirect");
  }

  const fragment = new URL(location).hash.slice(1);
  const params = new URLSearchParams(fragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) {
    throw new Error("No session tokens in verification redirect");
  }

  return { accessToken, refreshToken };
}
