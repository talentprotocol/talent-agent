/**
 * Unit tests for credential storage.
 *
 * Tests the file-based storage backend (Keychain is not available in
 * Bun's test environment) and the getValidToken / isTokenExpired logic.
 *
 * We mock `node:os` homedir to redirect file operations to a temp directory.
 * store.ts computes paths lazily via getConfigDir()/getCredentialsFile(), so
 * each call picks up the current tempHome value without vi.resetModules().
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshAuthToken } from "./client";
// Static imports — store.ts lazily computes config paths via homedir()
import {
  _resetKeychainCheck,
  clearCredentials,
  getValidToken,
  isTokenExpired,
  loadCredentials,
  saveCredentials,
} from "./store";

// ─── Setup ──────────────────────────────────────────────────────────────────

let tempHome: string;
const originalPlatform = process.platform;

/**
 * Mock homedir to return the current tempHome (captured by closure).
 * Bun doesn't support importOriginal, so we provide explicit exports.
 */
vi.mock("node:os", () => ({
  homedir: () => tempHome,
  tmpdir: () => require("os").tmpdir(),
}));

// Use vi.spyOn instead of vi.mock for ./client to avoid cross-file contamination.
// vi.mock leaks across test files in Bun 1.x; vi.spyOn + mockRestore cleans up properly.
let refreshAuthTokenSpy: ReturnType<typeof vi.spyOn> | undefined;

beforeEach(async () => {
  tempHome = mkdtempSync(join(tmpdir(), "talent-agent-store-test-"));

  // Force file backend (not macOS Keychain) for deterministic test isolation.
  // The Keychain is a global store that persists between tests.
  _resetKeychainCheck();
  Object.defineProperty(process, "platform", {
    value: "linux",
    writable: true,
  });

  const clientModule = await import("./client");
  refreshAuthTokenSpy = vi
    .spyOn(clientModule, "refreshAuthToken")
    .mockResolvedValue(undefined as any);
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  refreshAuthTokenSpy?.mockRestore();
  // Restore platform for next test
  Object.defineProperty(process, "platform", {
    value: originalPlatform,
    writable: true,
  });
  _resetKeychainCheck();
  // Use clearAllMocks (not restoreAllMocks) to avoid resetting the
  // vi.mock("node:os") factory's homedir implementation between tests.
  vi.clearAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("isTokenExpired", () => {
  it("returns false for a future timestamp in seconds", () => {
    const futureSeconds = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired(futureSeconds)).toBe(false);
  });

  it("returns true for a past timestamp in seconds", () => {
    const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
    expect(isTokenExpired(pastSeconds)).toBe(true);
  });

  it("returns false for a future timestamp in milliseconds", () => {
    const futureMs = Date.now() + 3600000;
    expect(isTokenExpired(futureMs)).toBe(false);
  });

  it("returns true for a past timestamp in milliseconds", () => {
    const pastMs = Date.now() - 3600000;
    expect(isTokenExpired(pastMs)).toBe(true);
  });
});

describe("saveCredentials / loadCredentials round-trip", () => {
  it("saves and loads credentials via file backend", () => {
    const creds = {
      token: "test-jwt-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      authMethod: "email" as const,
      email: "user@example.com",
    };

    saveCredentials(creds);

    const loaded = loadCredentials();
    expect(loaded).not.toBeNull();
    expect(loaded!.token).toBe("test-jwt-token");
    expect(loaded!.authMethod).toBe("email");
    expect(loaded!.email).toBe("user@example.com");
  });

  it("creates the .talent-agent directory if it doesn't exist", () => {
    const configDir = join(tempHome, ".talent-agent");
    expect(existsSync(configDir)).toBe(false);

    saveCredentials({
      token: "test",
      expiresAt: 9999999999,
      authMethod: "google",
    });

    expect(existsSync(configDir)).toBe(true);
  });

  it("writes credentials file as valid JSON", () => {
    saveCredentials({
      token: "test",
      expiresAt: 9999999999,
      authMethod: "google",
    });

    const credFile = join(tempHome, ".talent-agent", "credentials.json");
    expect(existsSync(credFile)).toBe(true);

    const content = readFileSync(credFile, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.token).toBe("test");
  });
});

describe("clearCredentials", () => {
  it("removes the credentials file", () => {
    saveCredentials({
      token: "test",
      expiresAt: 9999999999,
      authMethod: "email",
    });

    expect(loadCredentials()).not.toBeNull();

    clearCredentials();

    expect(loadCredentials()).toBeNull();
  });

  it("does not throw when no credentials exist", () => {
    expect(() => clearCredentials()).not.toThrow();
  });
});

describe("loadCredentials edge cases", () => {
  it("returns null when no credentials file exists", () => {
    expect(loadCredentials()).toBeNull();
  });

  it("returns null when credentials file contains invalid JSON", () => {
    const configDir = join(tempHome, ".talent-agent");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "credentials.json"), "not json", "utf-8");

    expect(loadCredentials()).toBeNull();
  });
});

describe("getValidToken", () => {
  it("returns token when credentials are valid and not expired", async () => {
    saveCredentials({
      token: "valid-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      authMethod: "email",
    });

    const token = await getValidToken();
    expect(token).toBe("valid-token");
  });

  it("returns null when no credentials are stored", async () => {
    const token = await getValidToken();
    expect(token).toBeNull();
  });

  it("refreshes expired token and saves new credentials", async () => {
    // Save expired credentials
    saveCredentials({
      token: "expired-token",
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // expired
      authMethod: "email",
      email: "user@example.com",
    });

    // Mock refresh to return a new token
    refreshAuthTokenSpy!.mockResolvedValue({
      auth: {
        token: "refreshed-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    } as any);

    const token = await getValidToken();
    expect(token).toBe("refreshed-token");
    expect(refreshAuthTokenSpy).toHaveBeenCalledWith("expired-token");
  });

  it("returns null and clears credentials when refresh fails", async () => {
    // Save expired credentials
    saveCredentials({
      token: "expired-token",
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
      authMethod: "email",
    });

    // Mock refresh to fail
    refreshAuthTokenSpy!.mockRejectedValue(new Error("Token expired"));

    const token = await getValidToken();
    expect(token).toBeNull();

    // Credentials should have been cleared
    expect(loadCredentials()).toBeNull();
  });
});
