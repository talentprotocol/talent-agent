/**
 * Local HTTP server for the Google OAuth redirect callback.
 *
 * Flow:
 * 1. Start a temporary HTTP server on a random available port.
 * 2. Build the Google OAuth URL with redirect_uri pointing to this server.
 * 3. Open the user's browser to the OAuth URL.
 * 4. Wait for Google to redirect back with an authorization code.
 * 5. Exchange the code for an ID token via Google's token endpoint.
 * 6. Shut down the server and return the ID token.
 *
 * Requires env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGoogleClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id)
    throw new Error("GOOGLE_CLIENT_ID is not set. Required for Google auth.");
  return id;
}

function getGoogleClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret)
    throw new Error(
      "GOOGLE_CLIENT_SECRET is not set. Required for Google auth.",
    );
  return secret;
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";

  try {
    Bun.spawn([command, url], { stdout: "ignore", stderr: "ignore" });
  } catch {
    // If browser open fails, the user will see the URL printed to stderr
    process.stderr.write(`\nOpen this URL in your browser:\n${url}\n\n`);
  }
}

// ─── OAuth Flow ─────────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Exchange an authorization code for an ID token using Google's token endpoint.
 */
async function exchangeCodeForIdToken(
  code: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as { id_token?: string };
  if (!data.id_token) {
    throw new Error("Google token response did not include an id_token.");
  }

  return data.id_token;
}

/**
 * Start the full Google OAuth flow:
 * - Starts a local callback server
 * - Opens browser for Google sign-in
 * - Receives the auth code
 * - Exchanges it for an ID token
 * - Returns the ID token
 */
export async function startGoogleOAuthFlow(): Promise<string> {
  const clientId = getGoogleClientId();

  return new Promise<string>((resolve, reject) => {
    // Use Bun.serve to start a local HTTP server
    const server = Bun.serve({
      port: 0, // Random available port
      async fetch(req) {
        const url = new URL(req.url);

        // Handle the OAuth callback
        if (url.pathname === "/callback") {
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");

          if (error) {
            // Respond to the browser, then reject
            setTimeout(() => {
              server.stop();
              reject(new Error(`Google OAuth error: ${error}`));
            }, 100);
            return new Response(
              successHtml(
                "Authentication failed. You can close this tab.",
                true,
              ),
              { headers: { "Content-Type": "text/html" } },
            );
          }

          if (!code) {
            setTimeout(() => {
              server.stop();
              reject(new Error("No authorization code received from Google."));
            }, 100);
            return new Response(
              successHtml(
                "No authorization code received. You can close this tab.",
                true,
              ),
              { headers: { "Content-Type": "text/html" } },
            );
          }

          // Exchange code for ID token
          try {
            const redirectUri = `http://localhost:${server.port}/callback`;
            const idToken = await exchangeCodeForIdToken(code, redirectUri);

            setTimeout(() => {
              server.stop();
              resolve(idToken);
            }, 100);

            return new Response(
              successHtml("Authentication successful! You can close this tab."),
              { headers: { "Content-Type": "text/html" } },
            );
          } catch (err) {
            setTimeout(() => {
              server.stop();
              reject(err);
            }, 100);
            return new Response(
              successHtml(
                "Token exchange failed. You can close this tab.",
                true,
              ),
              { headers: { "Content-Type": "text/html" } },
            );
          }
        }

        return new Response("Not found", { status: 404 });
      },
    });

    const redirectUri = `http://localhost:${server.port}/callback`;
    const state = Math.random().toString(36).substring(2, 15);

    const authUrl = new URL(GOOGLE_AUTH_URL);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "select_account");

    process.stderr.write(`Opening browser for Google sign-in...\n`);
    openBrowser(authUrl.toString());
    process.stderr.write(
      `Waiting for callback on http://localhost:${server.port}/callback\n`,
    );

    // Timeout after 5 minutes
    setTimeout(
      () => {
        server.stop();
        reject(new Error("Google OAuth timed out after 5 minutes."));
      },
      5 * 60 * 1000,
    );
  });
}

// ─── HTML Response ──────────────────────────────────────────────────────────

function successHtml(message: string, isError = false): string {
  const color = isError ? "#dc3545" : "#28a745";
  return `<!DOCTYPE html>
<html>
<head><title>Talent CLI</title></head>
<body style="font-family: -apple-system, system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8f9fa;">
  <div style="text-align: center; padding: 2rem;">
    <h1 style="color: ${color}; margin-bottom: 0.5rem;">${isError ? "Error" : "Success"}</h1>
    <p style="color: #495057; font-size: 1.1rem;">${message}</p>
    <p style="color: #6c757d; font-size: 0.9rem;">Return to your terminal to continue.</p>
  </div>
</body>
</html>`;
}
