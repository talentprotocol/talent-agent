/**
 * Tests for the Node.js bin wrapper (bin/cli.mjs).
 *
 * The wrapper delegates to `bun src/index.ts`, so we test it by running
 * it as a subprocess with `node` -- the same way npm would invoke it.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const BIN_PATH = resolve(__dirname, "..", "bin", "cli.mjs");

/**
 * Helper to run the bin wrapper via `node` and capture output.
 */
function runBin(
  args: string[],
  env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [BIN_PATH, ...args], {
      env: {
        ...process.env,
        NO_COLOR: "1",
        ...env,
      },
      encoding: "utf-8",
      timeout: 15000,
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

describe("bin/cli.mjs wrapper", () => {
  it("forwards --version and prints a semver string", () => {
    const { stdout, exitCode } = runBin(["--version"]);

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });

  it("forwards --help and prints usage text", () => {
    const { stdout, exitCode } = runBin(["--help"]);

    expect(stdout).toContain("Talent Agent CLI");
    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("OPTIONS:");
    expect(exitCode).toBe(0);
  });

  it("forwards --help --json and prints JSON schema", () => {
    const { stdout, exitCode } = runBin(["--help", "--json"]);

    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("talent-agent");
    expect(parsed.version).toBeDefined();
    expect(parsed.modes).toBeDefined();
    expect(exitCode).toBe(0);
  });

  it("forwards exit codes for unknown flags", () => {
    const { stderr, exitCode } = runBin(["--bad-flag"]);

    expect(stderr).toContain("Unknown flag: --bad-flag");
    expect(exitCode).toBe(2);
  });

  it("forwards -v shorthand", () => {
    const { stdout, exitCode } = runBin(["-v"]);

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });
});
