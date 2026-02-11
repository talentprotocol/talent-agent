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
import { openSync, writeSync, closeSync } from "node:fs";

// npm v7+ suppresses all lifecycle script stdout/stderr for successful
// scripts.  Writing directly to /dev/tty bypasses that capture and
// prints straight to the user's terminal.  Falls back to stderr when
// /dev/tty is unavailable (CI, Docker, non-interactive shells).
let ttyFd;
try {
  ttyFd = openSync("/dev/tty", "w");
} catch {
  // /dev/tty not available -- fall back to stderr
}

const log = (msg = "") => {
  const line = msg + "\n";
  if (ttyFd !== undefined) {
    writeSync(ttyFd, line);
  } else {
    process.stderr.write(line);
  }
};

let hasBun = false;
try {
  execFileSync("bun", ["--version"], { stdio: "ignore" });
  hasBun = true;
} catch {
  // bun not found -- warn below
}

log();
log("  talent-agent installed successfully!");
log();

if (!hasBun) {
  log("  Bun runtime is required but was not found.");
  log("  Install it:  curl -fsSL https://bun.sh/install | bash");
  log("  Then restart your terminal (or run: source ~/.bashrc)");
  log();
}

log("  Get started:");
log("    talent-agent login           Authenticate");
log('    talent-agent "Find devs"     Search for talent');
log("    talent-agent --help          Show all options");
log();

if (ttyFd !== undefined) {
  closeSync(ttyFd);
}
