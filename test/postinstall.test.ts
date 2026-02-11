/**
 * Tests for the post-install script (scripts/postinstall.js).
 *
 * Runs the script via `node` as a subprocess to verify its output,
 * matching how npm would execute it after `npm install`.
 */
import { execFileSync } from "node:child_process";
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
 */
function runPostinstall(env?: Record<string, string>): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  try {
    const stdout = execFileSync("node", [SCRIPT_PATH], {
      env: {
        ...process.env,
        ...env,
      },
      encoding: "utf-8",
      timeout: 10000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: error.status ?? 1,
    };
  }
}

describe("scripts/postinstall.js", () => {
  it("exits with code 0", () => {
    const { exitCode } = runPostinstall();

    expect(exitCode).toBe(0);
  });

  it("prints the success message", () => {
    const { stdout } = runPostinstall();

    expect(stdout).toContain("talent-agent installed successfully!");
  });

  it("prints getting-started instructions", () => {
    const { stdout } = runPostinstall();

    expect(stdout).toContain("talent-agent login");
    expect(stdout).toContain("talent-agent --help");
    expect(stdout).toContain("Get started:");
  });

  it("does not show the bun warning when bun is available", () => {
    const { stdout } = runPostinstall();

    // bun is available in this dev environment
    expect(stdout).not.toContain("Bun runtime is required but was not found");
  });

  it("shows the bun warning when bun is not on PATH", () => {
    const { stdout } = runPostinstall({ PATH: pathWithoutBun() });

    expect(stdout).toContain("Bun runtime is required but was not found");
    expect(stdout).toContain("curl -fsSL https://bun.sh/install | bash");
    expect(stdout).toContain("restart your terminal");
  });
});
