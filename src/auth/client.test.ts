/**
 * Unit tests for the Talent Protocol API auth client.
 *
 * Mocks global `fetch` and env vars to test each endpoint.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthToken,
  createNonce,
  emailRequestCode,
  emailVerifyCode,
  googleSignIn,
  refreshAuthToken,
} from "./client";

// ─── Setup ──────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TALENT_PROTOCOL_API_URL = "https://api.example.com";
  process.env.TALENT_PROTOCOL_API_KEY = "test-api-key";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockFetchOk(body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function mockFetchError(status: number, body: unknown): void {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("emailRequestCode", () => {
  it("sends POST to /auth/email_request_code with correct headers and body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    const result = await emailRequestCode("user@example.com");

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/auth/email_request_code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-API-KEY": "test-api-key",
        }),
        body: JSON.stringify({ email: "user@example.com" }),
      }),
    );
  });

  it("throws on non-ok response", async () => {
    mockFetchError(400, { error: "Invalid email" });

    await expect(emailRequestCode("bad")).rejects.toThrow("Invalid email");
  });
});

describe("emailVerifyCode", () => {
  it("returns auth token on success", async () => {
    const tokenResponse = {
      auth: { token: "jwt-token", expires_at: 1700000000 },
    };
    mockFetchOk(tokenResponse);

    const result = await emailVerifyCode("user@example.com", "123456");

    expect(result.auth.token).toBe("jwt-token");
    expect(result.auth.expires_at).toBe(1700000000);
  });

  it("throws on invalid code", async () => {
    mockFetchError(401, { error: "Invalid code" });

    await expect(emailVerifyCode("user@example.com", "000000")).rejects.toThrow(
      "Invalid code",
    );
  });
});

describe("googleSignIn", () => {
  it("sends id_token and returns auth token", async () => {
    const tokenResponse = {
      auth: { token: "google-jwt", expires_at: 1700000000 },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(tokenResponse), { status: 200 }),
      );

    const result = await googleSignIn("google-id-token");

    expect(result.auth.token).toBe("google-jwt");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/auth/google",
      expect.objectContaining({
        body: JSON.stringify({ id_token: "google-id-token" }),
      }),
    );
  });

  it("throws on failure", async () => {
    mockFetchError(401, { error: "Invalid Google token" });

    await expect(googleSignIn("bad-token")).rejects.toThrow(
      "Invalid Google token",
    );
  });
});

describe("createNonce", () => {
  it("returns nonce for wallet address", async () => {
    mockFetchOk({ nonce: "random-nonce-123" });

    const result = await createNonce(
      "0x1234567890abcdef1234567890abcdef12345678",
    );

    expect(result.nonce).toBe("random-nonce-123");
  });

  it("throws on failure", async () => {
    mockFetchError(400, { error: "Invalid address" });

    await expect(createNonce("invalid")).rejects.toThrow("Invalid address");
  });
});

describe("createAuthToken", () => {
  it("sends SIWE params and returns auth token", async () => {
    const tokenResponse = {
      auth: { token: "siwe-jwt", expires_at: 1700000000 },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(tokenResponse), { status: 200 }),
      );

    const result = await createAuthToken(
      "0x1234567890abcdef1234567890abcdef12345678",
      "0xsignature",
      1,
      "siwe-message",
    );

    expect(result.auth.token).toBe("siwe-jwt");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/auth/create_auth_token",
      expect.objectContaining({
        body: JSON.stringify({
          address: "0x1234567890abcdef1234567890abcdef12345678",
          signature: "0xsignature",
          chain_id: 1,
          siwe_message: "siwe-message",
        }),
      }),
    );
  });
});

describe("refreshAuthToken", () => {
  it("sends token in Authorization header and returns refreshed token", async () => {
    const tokenResponse = {
      auth: { token: "refreshed-jwt", expires_at: 1800000000 },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(tokenResponse), { status: 200 }),
      );

    const result = await refreshAuthToken("old-jwt");

    expect(result.auth.token).toBe("refreshed-jwt");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/auth/refresh_auth_token",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer old-jwt",
        }),
      }),
    );
  });

  it("throws when token is expired/invalid", async () => {
    mockFetchError(401, { error: "Token expired" });

    await expect(refreshAuthToken("expired-jwt")).rejects.toThrow(
      "Token expired",
    );
  });
});

describe("missing environment variables", () => {
  it("throws when TALENT_PROTOCOL_API_URL is missing", async () => {
    delete process.env.TALENT_PROTOCOL_API_URL;

    await expect(emailRequestCode("user@test.com")).rejects.toThrow(
      "TALENT_PROTOCOL_API_URL is not set",
    );
  });

  it("throws when TALENT_PROTOCOL_API_KEY is missing", async () => {
    delete process.env.TALENT_PROTOCOL_API_KEY;

    await expect(emailRequestCode("user@test.com")).rejects.toThrow(
      "TALENT_PROTOCOL_API_KEY is not set",
    );
  });
});

describe("error response handling", () => {
  it("uses fallback message when response body is not JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not JSON", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    await expect(emailRequestCode("user@test.com")).rejects.toThrow(
      "Failed to request email code",
    );
  });

  it("attaches status code to error", async () => {
    mockFetchError(403, { error: "Forbidden" });

    try {
      await emailRequestCode("user@test.com");
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.status).toBe(403);
      expect(err.message).toBe("Forbidden");
    }
  });
});
