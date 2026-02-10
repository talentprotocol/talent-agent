/**
 * Unit tests for interactive authentication flows.
 *
 * Mocks readline (prompts), the auth client, and credential storage
 * to test the email, Google, wallet, and interactive login selection flows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthToken,
  createCliSession,
  createNonce,
  emailRequestCode,
  emailVerifyCode,
  pollCliSession,
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
  createCliSession: vi.fn().mockResolvedValue({ sessionId: "mock-session-id" }),
  pollCliSession: vi.fn().mockResolvedValue({
    status: "complete",
    auth: { token: "google-jwt", expires_at: 1700000000 },
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
  it("creates a CLI session, polls, and saves credentials", async () => {
    const creds = await runGoogleFlow();

    expect(createCliSession).toHaveBeenCalled();
    expect(pollCliSession).toHaveBeenCalledWith("mock-session-id");
    expect(saveCredentials).toHaveBeenCalledWith({
      token: "google-jwt",
      expiresAt: 1700000000,
      authMethod: "google",
    });
    expect(creds.token).toBe("google-jwt");
    expect(creds.authMethod).toBe("google");
  });

  it("throws when session expires", async () => {
    vi.mocked(pollCliSession).mockResolvedValueOnce({ status: "expired" });

    await expect(runGoogleFlow()).rejects.toThrow("session expired");
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
    const creds = await runInteractiveLogin("google");

    expect(creds.authMethod).toBe("google");
    expect(creds.token).toBe("google-jwt");
    expect(createCliSession).toHaveBeenCalled();
    expect(pollCliSession).toHaveBeenCalledWith("mock-session-id");
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
