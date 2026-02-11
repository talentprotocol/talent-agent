#!/usr/bin/env node

/**
 * Node.js-compatible wrapper for talent-agent CLI.
 *
 * talent-agent requires the Bun runtime. This wrapper:
 *   1. Checks that `bun` is available on the PATH.
 *   2. Spawns the real TypeScript entry point with `bun`.
 *   3. Forwards stdio, signals, and exit codes transparently.
 */

import { spawn, execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "..", "src", "index.ts");

// ─── Verify Bun is installed ────────────────────────────────────────────────

try {
  execFileSync("bun", ["--version"], { stdio: "ignore" });
} catch {
  console.error(
    "talent-agent requires the Bun runtime.\n\n" +
      "  Install it:  curl -fsSL https://bun.sh/install | bash\n" +
      "  Then restart your terminal (or run: source ~/.bashrc)\n",
  );
  process.exit(1);
}

// ─── Spawn Bun with the real entry point ────────────────────────────────────

const child = spawn("bun", [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});

// Forward signals so Ctrl-C, SIGTERM, etc. reach the child process.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("close", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 1);
  }
});
