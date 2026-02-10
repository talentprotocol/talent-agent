/**
 * Unit tests for the talent-pro auth client.
 *
 * Mocks global `fetch` and env vars to test each endpoint.
 * All requests now go through talent-pro (TALENT_PRO_URL),
 * not the Talent API directly.
 *
 * Note: flows.test.ts runs before this file and mocks ./client.
 * flows.test.ts now calls mock.restore() in afterAll to prevent leaking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthToken,
  createCliSession,
  createNonce,
  emailRequestCode,
  emailVerifyCode,
  getCliAuthUrl,
  pollCliSession,
  refreshAuthToken,
} from "./client";

// ─── Setup ──────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TALENT_PRO_URL = "https://pro.talent.app";
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
  it("sends POST to /api/auth/email-request-code with correct headers and body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    const result = await emailRequestCode("user@example.com");

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pro.talent.app/api/auth/email-request-code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ email: "user@example.com" }),
      }),
    );
    // Should NOT include X-API-KEY
    const callHeaders = fetchSpy.mock.calls[0]![1]?.headers as Record<
      string,
      string
    >;
    expect(callHeaders["X-API-KEY"]).toBeUndefined();
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

  it("calls the correct talent-pro URL", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ auth: { token: "t", expires_at: 0 } }), {
        status: 200,
      }),
    );

    await emailVerifyCode("user@example.com", "123456");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pro.talent.app/api/auth/email-verify-code",
      expect.anything(),
    );
  });

  it("throws on invalid code", async () => {
    mockFetchError(401, { error: "Invalid code" });

    await expect(emailVerifyCode("user@example.com", "000000")).rejects.toThrow(
      "Invalid code",
    );
  });
});

describe("createCliSession", () => {
  it("creates a session and returns sessionId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ sessionId: "abc123" }), { status: 200 }),
      );

    const result = await createCliSession();

    expect(result.sessionId).toBe("abc123");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pro.talent.app/api/auth/cli/sessions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws on failure", async () => {
    mockFetchError(500, { error: "Internal server error" });

    await expect(createCliSession()).rejects.toThrow("Internal server error");
  });
});

describe("pollCliSession", () => {
  it("returns pending status", async () => {
    mockFetchOk({ status: "pending" });

    const result = await pollCliSession("session-123");

    expect(result.status).toBe("pending");
  });

  it("returns complete status with auth data", async () => {
    const response = {
      status: "complete",
      auth: { token: "google-jwt", expires_at: 1700000000 },
    };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(response), { status: 200 }),
      );

    const result = await pollCliSession("session-123");

    expect(result.status).toBe("complete");
    expect(result.auth?.token).toBe("google-jwt");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pro.talent.app/api/auth/cli/sessions/session-123",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns expired status", async () => {
    mockFetchOk({ status: "expired" });

    const result = await pollCliSession("session-123");

    expect(result.status).toBe("expired");
  });

  it("throws on failure", async () => {
    mockFetchError(500, { error: "Server error" });

    await expect(pollCliSession("session-123")).rejects.toThrow("Server error");
  });
});

describe("getCliAuthUrl", () => {
  it("returns the talent-pro base URL", () => {
    expect(getCliAuthUrl()).toBe("https://pro.talent.app");
  });

  it("strips trailing slash", () => {
    process.env.TALENT_PRO_URL = "https://pro.talent.app/";
    expect(getCliAuthUrl()).toBe("https://pro.talent.app");
  });
});

describe("createNonce", () => {
  it("returns nonce for wallet address", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ nonce: "random-nonce-123" }), {
        status: 200,
      }),
    );

    const result = await createNonce(
      "0x1234567890abcdef1234567890abcdef12345678",
    );

    expect(result.nonce).toBe("random-nonce-123");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pro.talent.app/api/auth/create-nonce",
      expect.anything(),
    );
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
      "https://pro.talent.app/api/auth/create-auth-token",
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
      "https://pro.talent.app/api/auth/refresh-auth-token",
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
  it("falls back to default URL when TALENT_PRO_URL is missing", async () => {
    delete process.env.TALENT_PRO_URL;

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );

    await emailRequestCode("user@test.com");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://pro.talent.app/api/auth/email-request-code",
      expect.anything(),
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
