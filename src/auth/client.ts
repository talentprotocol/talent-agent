/**
 * HTTP client for Talent Protocol API auth endpoints.
 *
 * Uses native `fetch` (available in Bun) to call the same endpoints
 * as the shared `@talent/data/services/talent/auth.ts` package, but
 * without any dependency on the talent-apps monorepo.
 *
 * All endpoints require the `X-API-KEY` header from `TALENT_PROTOCOL_API_KEY`.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthTokenResponse {
  auth: {
    token: string;
    expires_at: number;
  };
}

export interface EmailRequestCodeResponse {
  success: boolean;
  message?: string;
}

export interface CreateNonceResponse {
  nonce: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getApiBaseUrl(): string {
  const url = process.env.TALENT_PROTOCOL_API_URL;
  if (!url) throw new Error("TALENT_PROTOCOL_API_URL is not set");
  return url;
}

function getApiKey(): string {
  const key = process.env.TALENT_PROTOCOL_API_KEY;
  if (!key) throw new Error("TALENT_PROTOCOL_API_KEY is not set");
  return key;
}

function defaultHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-KEY": getApiKey(),
  };
}

function headersWithAuth(token: string): Record<string, string> {
  return {
    ...defaultHeaders(),
    Authorization: `Bearer ${token}`,
  };
}

async function handleErrorResponse(
  response: Response,
  fallbackMessage: string,
): Promise<never> {
  let errorMessage = fallbackMessage;
  try {
    const body = (await response.json()) as {
      error?: string;
      message?: string;
    };
    if (body.error) errorMessage = body.error;
    else if (body.message) errorMessage = body.message;
  } catch {
    // Response body wasn't JSON — use fallback message
  }
  const err = new Error(errorMessage);
  (err as Error & { status?: number }).status = response.status;
  throw err;
}

// ─── Auth Endpoints ─────────────────────────────────────────────────────────

/**
 * Request a 6-digit email verification code.
 * POST /auth/email_request_code
 */
export async function emailRequestCode(
  email: string,
): Promise<EmailRequestCodeResponse> {
  const response = await fetch(`${getApiBaseUrl()}/auth/email_request_code`, {
    method: "POST",
    headers: defaultHeaders(),
    body: JSON.stringify({ email }),
  });

  if (!response.ok) {
    await handleErrorResponse(response, "Failed to request email code");
  }

  return response.json() as Promise<EmailRequestCodeResponse>;
}

/**
 * Verify a 6-digit email code and get an auth token.
 * POST /auth/email_verify_code
 */
export async function emailVerifyCode(
  email: string,
  code: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getApiBaseUrl()}/auth/email_verify_code`, {
    method: "POST",
    headers: defaultHeaders(),
    body: JSON.stringify({ email, code }),
  });

  if (!response.ok) {
    await handleErrorResponse(response, "Failed to verify email code");
  }

  return response.json() as Promise<AuthTokenResponse>;
}

/**
 * Authenticate with a Google ID token.
 * POST /auth/google
 */
export async function googleSignIn(
  idToken: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getApiBaseUrl()}/auth/google`, {
    method: "POST",
    headers: defaultHeaders(),
    body: JSON.stringify({ id_token: idToken }),
  });

  if (!response.ok) {
    await handleErrorResponse(response, "Failed to sign in with Google");
  }

  return response.json() as Promise<AuthTokenResponse>;
}

/**
 * Create a nonce for wallet (SIWE) authentication.
 * POST /auth/create_nonce
 */
export async function createNonce(
  address: string,
): Promise<CreateNonceResponse> {
  const response = await fetch(`${getApiBaseUrl()}/auth/create_nonce`, {
    method: "POST",
    headers: defaultHeaders(),
    body: JSON.stringify({ address }),
  });

  if (!response.ok) {
    await handleErrorResponse(response, "Failed to create nonce");
  }

  return response.json() as Promise<CreateNonceResponse>;
}

/**
 * Create an auth token from a wallet signature (SIWE).
 * POST /auth/create_auth_token
 */
export async function createAuthToken(
  address: string,
  signature: string,
  chainId: number,
  siweMessage: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getApiBaseUrl()}/auth/create_auth_token`, {
    method: "POST",
    headers: defaultHeaders(),
    body: JSON.stringify({
      address,
      signature,
      chain_id: chainId,
      siwe_message: siweMessage,
    }),
  });

  if (!response.ok) {
    await handleErrorResponse(response, "Failed to create auth token");
  }

  return response.json() as Promise<AuthTokenResponse>;
}

/**
 * Refresh an existing auth token.
 * POST /auth/refresh_auth_token
 */
export async function refreshAuthToken(
  token: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getApiBaseUrl()}/auth/refresh_auth_token`, {
    method: "POST",
    headers: headersWithAuth(token),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    await handleErrorResponse(response, "Failed to refresh auth token");
  }

  return response.json() as Promise<AuthTokenResponse>;
}
