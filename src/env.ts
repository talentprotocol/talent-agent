/**
 * Environment variable loading and validation for the CLI.
 *
 * Loads .env from the CLI directory or talent-pro app directory.
 * Required vars are for auth + the talent-pro API, not for local agent execution.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_ENV_VARS = [
  "TALENT_PROTOCOL_API_URL",
  "TALENT_PROTOCOL_API_KEY",
  "TALENT_PRO_URL",
] as const;

/**
 * Load environment variables from .env files.
 * Tries talent-agent/.env first, then falls back to talent-apps/apps/talent-pro/.env.
 */
export function loadEnv(): void {
  const cliDir = resolve(import.meta.dir, "..");
  const proDir = resolve(cliDir, "..", "talent-apps", "apps", "talent-pro");

  const envPaths = [resolve(cliDir, ".env"), resolve(proDir, ".env")];

  for (const envPath of envPaths) {
    if (existsSync(envPath)) {
      parseEnvSync(envPath);
      break;
    }
  }
}

function parseEnvSync(filePath: string): void {
  const content = require("fs").readFileSync(filePath, "utf-8") as string;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Only set if not already defined (don't override existing env)
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Validate that all required environment variables are set.
 * Exits with a clear error message if any are missing.
 */
export function validateEnv(): void {
  const missing: string[] = [];
  for (const envVar of REQUIRED_ENV_VARS) {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  }

  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    for (const v of missing) {
      console.error(`  - ${v}`);
    }
    console.error(
      "\nCreate a .env file in talent-agent/ with these variables.",
    );
    console.error(
      "You can also place it in talent-apps/apps/talent-pro/.env as a fallback.",
    );
    process.exit(1);
  }
}
