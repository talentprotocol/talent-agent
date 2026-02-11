/**
 * Unit tests for interactive authentication flows.
 *
 * Mocks readline (prompts), the auth client, and credential storage
 * to test the email, Google, wallet, and interactive login selection flows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthToken,
  createNonce,
  emailRequestCode,
  emailVerifyCode,
} from "./client";
import {
  runEmailFlow,
  runGoogleFlow,
  runInteractiveLogin,
  runWalletFlow,
} from "./flows";
import { saveCredentials } from "./store";

// Mock node:readline — vi.mock works with ESM (vi.spyOn does not)
const mockQuestion = vi.fn();
const mockClose = vi.fn();

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: mockQuestion,
    close: mockClose,
  }),
}));

// Track the mock HTTP server's request handler and lifecycle
let mockServerHandler: ((req: any, res: any) => void) | null = null;
let mockServerPort = 54321;
const mockServerListen = vi.fn();
const mockServerClose = vi.fn();
const mockServerOn = vi.fn();

vi.mock("node:http", () => ({
  createServer: vi.fn((handler: (req: any, res: any) => void) => {
    mockServerHandler = handler;
    return {
      listen: mockServerListen.mockImplementation(
        (_port: number, _host: string) => {
          // Simulate the "listening" event asynchronously
          setTimeout(() => {
            const listeningCb = mockServerOn.mock.calls.find(
              (c) => c[0] === "listening",
            )?.[1];
            listeningCb?.();
          }, 0);
        },
      ),
      close: mockServerClose,
      on: mockServerOn,
      address: () => ({ port: mockServerPort }),
    };
  }),
}));

// Mock auth client
vi.mock("./client", () => ({
  emailRequestCode: vi.fn().mockResolvedValue({ success: true }),
  emailVerifyCode: vi.fn().mockResolvedValue({
    auth: { token: "email-jwt", expires_at: 1700000000 },
  }),
  createNonce: vi.fn().mockResolvedValue({ nonce: "test-nonce" }),
  createAuthToken: vi.fn().mockResolvedValue({
    auth: { token: "wallet-jwt", expires_at: 1700000000 },
  }),
  getCliAuthUrl: vi.fn().mockReturnValue("https://pro.talent.app"),
}));

vi.mock("./store", () => ({
  saveCredentials: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Configure mockQuestion to answer prompts in sequence.
 */
function setPromptAnswers(...answers: string[]): void {
  let callIndex = 0;
  mockQuestion.mockImplementation(
    (_question: string, callback: (answer: string) => void) => {
      const answer = answers[callIndex++] ?? "";
      callback(answer);
    },
  );
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("runEmailFlow", () => {
  it("prompts for email and code, then saves credentials", async () => {
    setPromptAnswers("user@example.com", "123456");

    const creds = await runEmailFlow();

    expect(emailRequestCode).toHaveBeenCalledWith("user@example.com");
    expect(emailVerifyCode).toHaveBeenCalledWith("user@example.com", "123456");
    expect(saveCredentials).toHaveBeenCalledWith({
      token: "email-jwt",
      expiresAt: 1700000000,
      authMethod: "email",
      email: "user@example.com",
    });
    expect(creds.token).toBe("email-jwt");
    expect(creds.authMethod).toBe("email");
  });

  it("throws when email is empty", async () => {
    setPromptAnswers("");

    await expect(runEmailFlow()).rejects.toThrow("Email is required");
  });

  it("throws when email format is invalid", async () => {
    setPromptAnswers("not-an-email");

    await expect(runEmailFlow()).rejects.toThrow("Invalid email format");
  });

  it("throws when code is not 6 digits", async () => {
    setPromptAnswers("user@example.com", "12345");

    await expect(runEmailFlow()).rejects.toThrow("6-digit code is required");
  });
});

describe("runWalletFlow", () => {
  it("prompts for address and signature, then saves credentials", async () => {
    const validAddress = "0x1234567890abcdef1234567890abcdef12345678";
    setPromptAnswers(validAddress, "0xmysignature");

    const creds = await runWalletFlow();

    expect(createNonce).toHaveBeenCalledWith(validAddress);
    expect(createAuthToken).toHaveBeenCalledWith(
      validAddress,
      "0xmysignature",
      1,
      expect.stringContaining("talent-agent wants you to sign in"),
    );
    expect(saveCredentials).toHaveBeenCalledWith({
      token: "wallet-jwt",
      expiresAt: 1700000000,
      authMethod: "wallet",
      address: validAddress,
    });
    expect(creds.token).toBe("wallet-jwt");
    expect(creds.authMethod).toBe("wallet");
  });

  it("throws when address is invalid", async () => {
    setPromptAnswers("invalid-address");

    await expect(runWalletFlow()).rejects.toThrow(
      "valid Ethereum address is required",
    );
  });

  it("throws when signature is empty", async () => {
    const validAddress = "0x1234567890abcdef1234567890abcdef12345678";
    setPromptAnswers(validAddress, "");

    await expect(runWalletFlow()).rejects.toThrow("Signature is required");
  });
});

describe("runGoogleFlow", () => {
  beforeEach(() => {
    mockServerHandler = null;
    mockServerListen.mockClear();
    mockServerClose.mockClear();
    mockServerOn.mockClear();
  });

  it("starts a localhost server, opens browser, and saves credentials on callback", async () => {
    // Run the flow — it will start the server and wait for the callback
    const credsPromise = runGoogleFlow();

    // Wait a tick for the server to "start"
    await new Promise((r) => setTimeout(r, 10));

    // Simulate the browser redirecting back with token
    expect(mockServerHandler).not.toBeNull();
    const mockRes = {
      writeHead: vi.fn(),
      end: vi.fn(),
    };
    mockServerHandler!(
      { url: "/callback?token=google-jwt&expires_at=1700000000" },
      mockRes,
    );

    const creds = await credsPromise;

    expect(mockServerListen).toHaveBeenCalledWith(0, "127.0.0.1");
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/html",
    });
    expect(mockServerClose).toHaveBeenCalled();
    expect(saveCredentials).toHaveBeenCalledWith({
      token: "google-jwt",
      expiresAt: 1700000000,
      authMethod: "google",
    });
    expect(creds.token).toBe("google-jwt");
    expect(creds.authMethod).toBe("google");
  });

  it("returns 404 for non-callback paths", async () => {
    const credsPromise = runGoogleFlow();
    await new Promise((r) => setTimeout(r, 10));

    // Request to wrong path
    const mockRes404 = { writeHead: vi.fn(), end: vi.fn() };
    mockServerHandler!({ url: "/wrong-path" }, mockRes404);
    expect(mockRes404.writeHead).toHaveBeenCalledWith(404);

    // Then the real callback comes
    const mockRes = { writeHead: vi.fn(), end: vi.fn() };
    mockServerHandler!(
      { url: "/callback?token=google-jwt&expires_at=1700000000" },
      mockRes,
    );

    await credsPromise;
  });

  it("returns 400 when callback is missing params", async () => {
    const credsPromise = runGoogleFlow();
    await new Promise((r) => setTimeout(r, 10));

    // Callback without token
    const mockRes400 = { writeHead: vi.fn(), end: vi.fn() };
    mockServerHandler!({ url: "/callback?token=abc" }, mockRes400);
    expect(mockRes400.writeHead).toHaveBeenCalledWith(400);

    // Then valid callback
    const mockRes = { writeHead: vi.fn(), end: vi.fn() };
    mockServerHandler!(
      { url: "/callback?token=google-jwt&expires_at=1700000000" },
      mockRes,
    );

    await credsPromise;
  });
});

describe("runInteractiveLogin", () => {
  it("dispatches to email flow when method is 'email'", async () => {
    setPromptAnswers("user@example.com", "123456");

    const creds = await runInteractiveLogin("email");

    expect(creds.authMethod).toBe("email");
    expect(emailRequestCode).toHaveBeenCalled();
  });

  it("dispatches to wallet flow when method is 'wallet'", async () => {
    const validAddress = "0x1234567890abcdef1234567890abcdef12345678";
    setPromptAnswers(validAddress, "0xsig");

    const creds = await runInteractiveLogin("wallet");

    expect(creds.authMethod).toBe("wallet");
    expect(createNonce).toHaveBeenCalled();
  });

  it("dispatches to google flow when method is 'google'", async () => {
    const credsPromise = runInteractiveLogin("google");
    await new Promise((r) => setTimeout(r, 10));

    // Simulate the browser callback
    const mockRes = { writeHead: vi.fn(), end: vi.fn() };
    mockServerHandler!(
      { url: "/callback?token=google-jwt&expires_at=1700000000" },
      mockRes,
    );

    const creds = await credsPromise;

    expect(creds.authMethod).toBe("google");
    expect(creds.token).toBe("google-jwt");
  });

  it("prompts for method selection when no method specified", async () => {
    // First prompt: method choice "1" = email
    // Then email flow prompts: email, code
    setPromptAnswers("1", "user@example.com", "123456");

    const creds = await runInteractiveLogin();

    expect(creds.authMethod).toBe("email");
  });

  it("throws for invalid method choice", async () => {
    setPromptAnswers("9"); // invalid choice

    await expect(runInteractiveLogin()).rejects.toThrow("Invalid choice");
  });
});
