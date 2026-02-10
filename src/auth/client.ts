/**
 * HTTP client for auth endpoints via talent-pro.
 *
 * All auth requests are routed through talent-pro's /api/auth/* proxy
 * endpoints. The CLI only needs TALENT_PRO_URL — no direct Talent API
 * connection or API key is required.
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

function getProUrl(): string {
  const url = process.env.TALENT_PRO_URL || "https://pro.talent.app";
  return url.replace(/\/$/, "");
}

function defaultHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
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
 * POST /api/auth/email-request-code
 */
export async function emailRequestCode(
  email: string,
): Promise<EmailRequestCodeResponse> {
  const response = await fetch(`${getProUrl()}/api/auth/email-request-code`, {
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
 * POST /api/auth/email-verify-code
 */
export async function emailVerifyCode(
  email: string,
  code: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getProUrl()}/api/auth/email-verify-code`, {
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
 * POST /api/auth/google
 */
export async function googleSignIn(
  idToken: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getProUrl()}/api/auth/google`, {
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
 * POST /api/auth/create-nonce
 */
export async function createNonce(
  address: string,
): Promise<CreateNonceResponse> {
  const response = await fetch(`${getProUrl()}/api/auth/create-nonce`, {
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
 * POST /api/auth/create-auth-token
 */
export async function createAuthToken(
  address: string,
  signature: string,
  chainId: number,
  siweMessage: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getProUrl()}/api/auth/create-auth-token`, {
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
 * POST /api/auth/refresh-auth-token
 */
export async function refreshAuthToken(
  token: string,
): Promise<AuthTokenResponse> {
  const response = await fetch(`${getProUrl()}/api/auth/refresh-auth-token`, {
    method: "POST",
    headers: {
      ...defaultHeaders(),
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    await handleErrorResponse(response, "Failed to refresh auth token");
  }

  return response.json() as Promise<AuthTokenResponse>;
}
