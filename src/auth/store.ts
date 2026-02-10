/**
 * Token persistence for the CLI.
 *
 * Two-tier storage strategy (same approach as GitHub CLI):
 *
 * 1. **Preferred: macOS Keychain** — tokens encrypted at rest, unlocked by
 *    OS login session. Uses the `security` CLI tool with no extra dependencies.
 *
 * 2. **Fallback: `~/.talent-agent/credentials.json`** — used when Keychain is
 *    unavailable (Linux, CI, non-interactive). File written with 0o600 perms.
 *
 * The store auto-detects: try Keychain first; if the `security` command fails
 * or the platform is not macOS, fall back to file.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { refreshAuthToken } from "./client";

// ─── Types ──────────────────────────────────────────────────────────────────

export type AuthMethod = "email" | "google" | "wallet";

export interface StoredCredentials {
  token: string;
  expiresAt: number;
  authMethod: AuthMethod;
  email?: string;
  address?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE = "talent-agent";
const KEYCHAIN_ACCOUNT = "default";

// Computed lazily so tests can mock homedir() per-test without vi.resetModules()
function getConfigDir(): string {
  return join(homedir(), ".talent-agent");
}
function getCredentialsFile(): string {
  return join(getConfigDir(), "credentials.json");
}

// ─── Keychain Backend (macOS) ───────────────────────────────────────────────

function isKeychainAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    const result = Bun.spawnSync(["which", "security"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function keychainWrite(data: string): boolean {
  try {
    // Delete existing entry first (ignore errors if not found)
    Bun.spawnSync([
      "security",
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
    ]);

    const result = Bun.spawnSync([
      "security",
      "add-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
      data,
      "-U",
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function keychainRead(): string | null {
  try {
    const result = Bun.spawnSync([
      "security",
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
      "-w",
    ]);
    if (result.exitCode !== 0) return null;
    return result.stdout.toString().trim();
  } catch {
    return null;
  }
}

function keychainDelete(): boolean {
  try {
    const result = Bun.spawnSync([
      "security",
      "delete-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      KEYCHAIN_ACCOUNT,
    ]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ─── File Backend ───────────────────────────────────────────────────────────

function ensureConfigDir(): void {
  if (!existsSync(getConfigDir())) {
    mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
  }
}

function fileWrite(data: string): boolean {
  try {
    ensureConfigDir();
    writeFileSync(getCredentialsFile(), data, {
      encoding: "utf-8",
      mode: 0o600,
    });
    return true;
  } catch {
    return false;
  }
}

function fileRead(): string | null {
  try {
    if (!existsSync(getCredentialsFile())) return null;
    return readFileSync(getCredentialsFile(), "utf-8");
  } catch {
    return null;
  }
}

function fileDelete(): boolean {
  try {
    if (existsSync(getCredentialsFile())) {
      unlinkSync(getCredentialsFile());
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

// Lazy-evaluated so tests can mock process.platform before the first call.
let _keychainChecked = false;
let _keychainAvailable = false;

function shouldUseKeychain(): boolean {
  if (!_keychainChecked) {
    _keychainAvailable = isKeychainAvailable();
    _keychainChecked = true;
  }
  return _keychainAvailable;
}

/**
 * Reset the keychain availability check (for testing only).
 * Call this before mocking process.platform to force re-evaluation.
 */
export function _resetKeychainCheck(): void {
  _keychainChecked = false;
  _keychainAvailable = false;
}

/**
 * Save credentials to the store (Keychain preferred, file fallback).
 */
export function saveCredentials(creds: StoredCredentials): void {
  const data = JSON.stringify(creds);

  if (shouldUseKeychain()) {
    if (keychainWrite(data)) return;
    // Keychain write failed — fall through to file
  }

  if (!fileWrite(data)) {
    throw new Error("Failed to save credentials to both Keychain and file.");
  }
}

/**
 * Load credentials from the store.
 * Checks Keychain first, then file.
 */
export function loadCredentials(): StoredCredentials | null {
  let raw: string | null = null;

  if (shouldUseKeychain()) {
    raw = keychainRead();
  }

  if (!raw) {
    raw = fileRead();
  }

  if (!raw) return null;

  try {
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

/**
 * Clear all stored credentials (both Keychain and file).
 */
export function clearCredentials(): void {
  if (shouldUseKeychain()) keychainDelete();
  fileDelete();
}

/**
 * Check if a token has expired.
 * Handles both seconds and milliseconds timestamps.
 */
export function isTokenExpired(expiresAt: number): boolean {
  const expiresAtMs =
    expiresAt > 1_000_000_000_000 ? expiresAt : expiresAt * 1000;
  return Date.now() >= expiresAtMs;
}

/**
 * Get a valid auth token, auto-refreshing if expired.
 *
 * Returns the token string if authenticated, or null if not logged in
 * or if the token cannot be refreshed.
 */
export async function getValidToken(): Promise<string | null> {
  const creds = loadCredentials();
  if (!creds) return null;

  // Token is still valid
  if (!isTokenExpired(creds.expiresAt)) {
    return creds.token;
  }

  // Token expired — try to refresh
  try {
    const refreshed = await refreshAuthToken(creds.token);
    if (refreshed?.auth?.token) {
      const updated: StoredCredentials = {
        ...creds,
        token: refreshed.auth.token,
        expiresAt: refreshed.auth.expires_at,
      };
      saveCredentials(updated);
      return updated.token;
    }
  } catch {
    // Refresh failed — token is no longer valid
  }

  // Clear stale credentials
  clearCredentials();
  return null;
}
