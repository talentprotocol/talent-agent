/**
 * Unit tests for interactive authentication flows.
 *
 * Mocks readline (prompts), the auth client, and credential storage
 * to test the email, wallet, and interactive login selection flows.
 * Google flow is tested lightly (it involves Bun.serve + browser).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAuthToken,
  createNonce,
  emailRequestCode,
  emailVerifyCode,
} from "./client";
import { runEmailFlow, runInteractiveLogin, runWalletFlow } from "./flows";
import { saveCredentials } from "./store";

// Mock readline for prompts — use vi.spyOn instead of vi.mock to prevent
// cross-file contamination (vi.mock leaks across files in Bun 1.x).
const mockQuestion = vi.fn();
const mockClose = vi.fn();

let readlineSpy: ReturnType<typeof vi.spyOn> | undefined;
let clientSpies: ReturnType<typeof vi.spyOn>[] = [];

// Keep vi.mock for modules that no downstream test needs as real:
// ./store (store.test.ts runs before this file) and ./google-server
vi.mock("./store", () => ({
  saveCredentials: vi.fn(),
}));

vi.mock("./google-server", () => ({
  startGoogleOAuthFlow: vi.fn().mockResolvedValue("mock-google-id-token"),
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

beforeEach(async () => {
  vi.clearAllMocks();

  // Spy on node:readline to return mock interface (prevents contaminating piped.test.ts)
  const readline = await import("node:readline");
  readlineSpy = vi.spyOn(readline, "createInterface").mockReturnValue({
    question: mockQuestion,
    close: mockClose,
  } as any);

  // Spy on ./client functions (prevents contaminating client.test.ts)
  const client = await import("./client");
  clientSpies = [
    vi
      .spyOn(client, "emailRequestCode")
      .mockResolvedValue({ success: true } as any),
    vi.spyOn(client, "emailVerifyCode").mockResolvedValue({
      auth: { token: "email-jwt", expires_at: 1700000000 },
    } as any),
    vi
      .spyOn(client, "createNonce")
      .mockResolvedValue({ nonce: "test-nonce" } as any),
    vi.spyOn(client, "createAuthToken").mockResolvedValue({
      auth: { token: "wallet-jwt", expires_at: 1700000000 },
    } as any),
    vi.spyOn(client, "googleSignIn").mockResolvedValue({
      auth: { token: "google-jwt", expires_at: 1700000000 },
    } as any),
  ];
});

afterEach(() => {
  readlineSpy?.mockRestore();
  for (const spy of clientSpies) spy.mockRestore();
  clientSpies = [];
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
