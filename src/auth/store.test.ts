/**
 * Unit tests for credential storage.
 *
 * Tests the file-based storage backend (Keychain is not available in
 * Vitest's Node.js environment) and the getValidToken / isTokenExpired logic.
 *
 * We mock `node:os` homedir to redirect file operations to a temp directory,
 * and use vi.resetModules() before each test so the module-level CONFIG_DIR
 * constant is recomputed with the fresh temp directory.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Setup ──────────────────────────────────────────────────────────────────

let tempHome: string;

/**
 * vi.mock is hoisted, so the homedir mock captures tempHome by closure.
 * After vi.resetModules(), the store module is re-imported and calls
 * homedir() again, getting the updated tempHome value.
 */
vi.mock("node:os", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("node:os");
  return {
    ...actual,
    homedir: () => tempHome,
  };
});

vi.mock("./client", () => ({
  refreshAuthToken: vi.fn(),
}));

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "talent-cli-store-test-"));
  vi.resetModules();
});

afterEach(() => {
  rmSync(tempHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Dynamically import the store module so it gets a fresh CONFIG_DIR
 * based on the current tempHome value.
 */
async function importStore() {
  return await import("./store");
}

async function importClient() {
  return await import("./client");
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("isTokenExpired", () => {
  it("returns false for a future timestamp in seconds", async () => {
    const { isTokenExpired } = await importStore();
    const futureSeconds = Math.floor(Date.now() / 1000) + 3600;
    expect(isTokenExpired(futureSeconds)).toBe(false);
  });

  it("returns true for a past timestamp in seconds", async () => {
    const { isTokenExpired } = await importStore();
    const pastSeconds = Math.floor(Date.now() / 1000) - 3600;
    expect(isTokenExpired(pastSeconds)).toBe(true);
  });

  it("returns false for a future timestamp in milliseconds", async () => {
    const { isTokenExpired } = await importStore();
    const futureMs = Date.now() + 3600000;
    expect(isTokenExpired(futureMs)).toBe(false);
  });

  it("returns true for a past timestamp in milliseconds", async () => {
    const { isTokenExpired } = await importStore();
    const pastMs = Date.now() - 3600000;
    expect(isTokenExpired(pastMs)).toBe(true);
  });
});

describe("saveCredentials / loadCredentials round-trip", () => {
  it("saves and loads credentials via file backend", async () => {
    const { saveCredentials, loadCredentials } = await importStore();

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

  it("creates the .talent-cli directory if it doesn't exist", async () => {
    const { saveCredentials } = await importStore();

    const configDir = join(tempHome, ".talent-cli");
    expect(existsSync(configDir)).toBe(false);

    saveCredentials({
      token: "test",
      expiresAt: 9999999999,
      authMethod: "google",
    });

    expect(existsSync(configDir)).toBe(true);
  });

  it("writes credentials file as valid JSON", async () => {
    const { saveCredentials } = await importStore();

    saveCredentials({
      token: "test",
      expiresAt: 9999999999,
      authMethod: "google",
    });

    const credFile = join(tempHome, ".talent-cli", "credentials.json");
    expect(existsSync(credFile)).toBe(true);

    const content = readFileSync(credFile, "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed.token).toBe("test");
  });
});

describe("clearCredentials", () => {
  it("removes the credentials file", async () => {
    const { saveCredentials, clearCredentials, loadCredentials } =
      await importStore();

    saveCredentials({
      token: "test",
      expiresAt: 9999999999,
      authMethod: "email",
    });

    expect(loadCredentials()).not.toBeNull();

    clearCredentials();

    expect(loadCredentials()).toBeNull();
  });

  it("does not throw when no credentials exist", async () => {
    const { clearCredentials } = await importStore();
    expect(() => clearCredentials()).not.toThrow();
  });
});

describe("loadCredentials edge cases", () => {
  it("returns null when no credentials file exists", async () => {
    const { loadCredentials } = await importStore();
    expect(loadCredentials()).toBeNull();
  });

  it("returns null when credentials file contains invalid JSON", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { loadCredentials } = await importStore();

    const configDir = join(tempHome, ".talent-cli");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "credentials.json"), "not json", "utf-8");

    expect(loadCredentials()).toBeNull();
  });
});

describe("getValidToken", () => {
  it("returns token when credentials are valid and not expired", async () => {
    const { saveCredentials, getValidToken } = await importStore();

    saveCredentials({
      token: "valid-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      authMethod: "email",
    });

    const token = await getValidToken();
    expect(token).toBe("valid-token");
  });

  it("returns null when no credentials are stored", async () => {
    const { getValidToken } = await importStore();
    const token = await getValidToken();
    expect(token).toBeNull();
  });

  it("refreshes expired token and saves new credentials", async () => {
    const { saveCredentials, getValidToken } = await importStore();
    const { refreshAuthToken } = await importClient();

    // Save expired credentials
    saveCredentials({
      token: "expired-token",
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // expired
      authMethod: "email",
      email: "user@example.com",
    });

    // Mock refresh to return a new token
    vi.mocked(refreshAuthToken).mockResolvedValue({
      auth: {
        token: "refreshed-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const token = await getValidToken();
    expect(token).toBe("refreshed-token");
    expect(refreshAuthToken).toHaveBeenCalledWith("expired-token");
  });

  it("returns null and clears credentials when refresh fails", async () => {
    const { saveCredentials, getValidToken, loadCredentials } =
      await importStore();
    const { refreshAuthToken } = await importClient();

    // Save expired credentials
    saveCredentials({
      token: "expired-token",
      expiresAt: Math.floor(Date.now() / 1000) - 3600,
      authMethod: "email",
    });

    // Mock refresh to fail
    vi.mocked(refreshAuthToken).mockRejectedValue(new Error("Token expired"));

    const token = await getValidToken();
    expect(token).toBeNull();

    // Credentials should have been cleared
    expect(loadCredentials()).toBeNull();
  });
});
