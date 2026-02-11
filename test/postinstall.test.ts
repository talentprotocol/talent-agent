/**
 * Tests for the post-install script (scripts/postinstall.js).
 *
 * Runs the script via `node` as a subprocess to verify its output,
 * matching how npm would execute it after `npm install`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = resolve(__dirname, "..", "scripts", "postinstall.js");

/**
 * Build a PATH string that keeps `node` reachable but hides `bun`.
 */
function pathWithoutBun(): string {
  const bunDir = dirname(
    execFileSync("which", ["bun"], { encoding: "utf-8" }).trim(),
  );
  return (process.env.PATH ?? "")
    .split(":")
    .filter((p) => p !== bunDir)
    .join(":");
}

/**
 * Helper to run the postinstall script and capture output.
 *
 * The script writes to /dev/tty (bypasses npm's stdio suppression) with
 * a fallback to stderr.  In tests we force the fallback by setting
 * FORCE_STDERR=1, which doesn't exist in the script -- instead we
 * redirect /dev/tty writes by running without a controlling terminal.
 * The simplest reliable approach: pipe the child's stdio so /dev/tty
 * open fails, triggering the stderr fallback that we CAN capture.
 */
function runPostinstall(env?: Record<string, string>): {
  output: string;
  exitCode: number;
} {
  const result = spawnSync("node", [SCRIPT_PATH], {
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf-8",
    timeout: 10000,
    // Piping stdio detaches the child from the controlling terminal,
    // so openSync("/dev/tty") falls back to stderr which we capture.
    stdio: ["pipe", "pipe", "pipe"],
  });
  return {
    output: (result.stdout ?? "") + (result.stderr ?? ""),
    exitCode: result.status ?? 1,
  };
}

describe("scripts/postinstall.js", () => {
  it("exits with code 0", () => {
    const { exitCode } = runPostinstall();

    expect(exitCode).toBe(0);
  });

  it("prints the success message", () => {
    const { output } = runPostinstall();

    expect(output).toContain("talent-agent installed successfully!");
  });

  it("prints getting-started instructions", () => {
    const { output } = runPostinstall();

    expect(output).toContain("talent-agent login");
    expect(output).toContain("talent-agent --help");
    expect(output).toContain("Get started:");
  });

  it("does not show the bun warning when bun is available", () => {
    const { output } = runPostinstall();

    // bun is available in this dev environment
    expect(output).not.toContain("Bun runtime is required but was not found");
  });

  it("shows the bun warning when bun is not on PATH", () => {
    const { output } = runPostinstall({ PATH: pathWithoutBun() });

    expect(output).toContain("Bun runtime is required but was not found");
    expect(output).toContain("curl -fsSL https://bun.sh/install | bash");
    expect(output).toContain("restart your terminal");
  });
});
