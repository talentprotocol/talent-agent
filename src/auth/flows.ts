/**
 * Interactive authentication flows for the CLI.
 *
 * Each flow prompts the user in the terminal, calls the Talent Protocol API,
 * and stores the resulting credentials.
 */
import { createInterface } from "node:readline";

import {
  createAuthToken,
  createNonce,
  emailRequestCode,
  emailVerifyCode,
  googleSignIn,
} from "./client";
import { startGoogleOAuthFlow } from "./google-server";
import {
  type AuthMethod,
  type StoredCredentials,
  saveCredentials,
} from "./store";

// ─── Helpers ────────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr, // Use stderr so prompts don't pollute stdout
    terminal: true,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function printToStderr(message: string): void {
  process.stderr.write(message + "\n");
}

// ─── Email Auth Flow ────────────────────────────────────────────────────────

export async function runEmailFlow(): Promise<StoredCredentials> {
  const email = await prompt("Email: ");
  if (!email) throw new Error("Email is required.");

  // Basic email validation
  if (!email.includes("@") || !email.includes(".")) {
    throw new Error("Invalid email format.");
  }

  printToStderr(`Sending verification code to ${email}...`);
  await emailRequestCode(email);
  printToStderr("Code sent! Check your inbox.");

  const code = await prompt("Enter the 6-digit code: ");
  if (!code || code.length !== 6) {
    throw new Error("A 6-digit code is required.");
  }

  printToStderr("Verifying code...");
  const response = await emailVerifyCode(email, code);

  const creds: StoredCredentials = {
    token: response.auth.token,
    expiresAt: response.auth.expires_at,
    authMethod: "email",
    email,
  };

  saveCredentials(creds);
  printToStderr(`Authenticated as ${email}`);
  return creds;
}

// ─── Google Auth Flow ───────────────────────────────────────────────────────

export async function runGoogleFlow(): Promise<StoredCredentials> {
  printToStderr("Starting Google authentication...");
  printToStderr("A browser window will open for you to sign in with Google.");

  const idToken = await startGoogleOAuthFlow();

  printToStderr("Exchanging token with Talent API...");
  const response = await googleSignIn(idToken);

  const creds: StoredCredentials = {
    token: response.auth.token,
    expiresAt: response.auth.expires_at,
    authMethod: "google",
  };

  saveCredentials(creds);
  printToStderr("Authenticated with Google");
  return creds;
}

// ─── Wallet (SIWE) Auth Flow ────────────────────────────────────────────────

export async function runWalletFlow(): Promise<StoredCredentials> {
  const address = await prompt("Wallet address (0x...): ");
  if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
    throw new Error(
      "A valid Ethereum address is required (0x... 40 hex chars).",
    );
  }

  printToStderr("Creating nonce...");
  const { nonce } = await createNonce(address);

  // Build a basic SIWE message
  const chainId = 1; // Default to Ethereum mainnet
  const domain = "talent-agent";
  const uri = "https://cli.talent.app";
  const issuedAt = new Date().toISOString();
  const siweMessage = [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to Talent CLI",
    "",
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");

  printToStderr("\nSign this message with your wallet:\n");
  printToStderr("─".repeat(60));
  printToStderr(siweMessage);
  printToStderr("─".repeat(60));
  printToStderr("");

  const signature = await prompt("Paste your signature: ");
  if (!signature) {
    throw new Error("Signature is required.");
  }

  printToStderr("Verifying signature...");
  const response = await createAuthToken(
    address,
    signature,
    chainId,
    siweMessage,
  );

  const creds: StoredCredentials = {
    token: response.auth.token,
    expiresAt: response.auth.expires_at,
    authMethod: "wallet",
    address,
  };

  saveCredentials(creds);
  printToStderr(`Authenticated as ${address}`);
  return creds;
}

// ─── Interactive Method Selection ───────────────────────────────────────────

const AUTH_METHODS: { key: string; label: string; method: AuthMethod }[] = [
  { key: "1", label: "Email (magic code)", method: "email" },
  { key: "2", label: "Google", method: "google" },
  { key: "3", label: "Wallet (SIWE)", method: "wallet" },
];

export async function runInteractiveLogin(
  preferredMethod?: AuthMethod,
): Promise<StoredCredentials> {
  let method = preferredMethod;

  if (!method) {
    printToStderr("\nChoose an authentication method:\n");
    for (const m of AUTH_METHODS) {
      printToStderr(`  ${m.key}) ${m.label}`);
    }
    printToStderr("");

    const choice = await prompt("Enter choice (1-3): ");
    const selected = AUTH_METHODS.find((m) => m.key === choice);

    if (!selected) {
      throw new Error("Invalid choice. Please enter 1, 2, or 3.");
    }
    method = selected.method;
  }

  switch (method) {
    case "email":
      return runEmailFlow();
    case "google":
      return runGoogleFlow();
    case "wallet":
      return runWalletFlow();
    default:
      throw new Error(`Unknown auth method: ${method}`);
  }
}
