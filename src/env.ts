/**
 * Environment variable loading and validation for the CLI.
 *
 * Loads .env from the talent-agent project directory.
 * TALENT_PRO_URL defaults to https://pro.talent.app if not set.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_TALENT_PRO_URL = "https://pro.talent.app";

/**
 * Load environment variables from the .env file in the project root.
 */
export function loadEnv(): void {
  const cliDir = resolve(import.meta.dir, "..");
  const envPath = resolve(cliDir, ".env");

  if (existsSync(envPath)) {
    parseEnvSync(envPath);
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
 * Apply defaults for optional env vars and validate the environment.
 */
export function validateEnv(): void {
  if (!process.env.TALENT_PRO_URL) {
    process.env.TALENT_PRO_URL = DEFAULT_TALENT_PRO_URL;
  }
}
