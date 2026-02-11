#!/usr/bin/env node

/**
 * Post-install script for talent-agent.
 *
 * Prints a welcome message with getting-started instructions and warns
 * if the required Bun runtime is not found on the PATH.
 *
 * Runs with Node.js (no Bun dependency) so it works in any npm environment.
 */

import { execFileSync } from "node:child_process";

let hasBun = false;
try {
  execFileSync("bun", ["--version"], { stdio: "ignore" });
  hasBun = true;
} catch {
  // bun not found -- warn below
}

console.log("");
console.log("  talent-agent installed successfully!");
console.log("");

if (!hasBun) {
  console.log("  Bun runtime is required but was not found.");
  console.log("  Install it:  curl -fsSL https://bun.sh/install | bash");
  console.log("  Then restart your terminal (or run: source ~/.bashrc)");
  console.log("");
}

console.log("  Get started:");
console.log("    talent-agent login           Authenticate");
console.log('    talent-agent "Find devs"     Search for talent');
console.log("    talent-agent --help          Show all options");
console.log("");
