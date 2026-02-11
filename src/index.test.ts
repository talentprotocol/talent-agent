/**
 * Tests for the CLI entry point argument parsing and help/version output.
 *
 * Since parseArgs and friends are not exported, we test the CLI behavior
 * by running it as a subprocess with different arguments.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CLI_PATH = resolve(__dirname, "index.ts");

/**
 * Helper to run the CLI as a subprocess and capture output.
 */
function runCli(
  args: string[],
  env?: Record<string, string>,
): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("bun", ["run", CLI_PATH, ...args], {
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

describe("CLI --version", () => {
  it("prints the version and exits with 0", () => {
    const { stdout, exitCode } = runCli(["--version"]);

    // Should contain a version string (e.g., "1.0.0")
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });

  it("supports -v shorthand", () => {
    const { stdout, exitCode } = runCli(["-v"]);

    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    expect(exitCode).toBe(0);
  });
});

describe("CLI --help", () => {
  it("prints help text and exits with 0", () => {
    const { stdout, exitCode } = runCli(["--help"]);

    expect(stdout).toContain("Talent Agent CLI");
    expect(stdout).toContain("USAGE:");
    expect(stdout).toContain("OPTIONS:");
    expect(stdout).toContain("--json");
    expect(stdout).toContain("--session");
    expect(stdout).toContain("--pipe");
    expect(stdout).toContain("--serve");
    expect(stdout).toContain("--debug");
    expect(stdout).toContain("ENVIRONMENT VARIABLES:");
    expect(stdout).toContain("INTERACTIVE MODE:");
    expect(exitCode).toBe(0);
  });

  it("supports -h shorthand", () => {
    const { stdout, exitCode } = runCli(["-h"]);

    expect(stdout).toContain("Talent Agent CLI");
    expect(exitCode).toBe(0);
  });
});

describe("CLI --help --json", () => {
  it("prints JSON schema when --help and --json are combined", () => {
    const { stdout, exitCode } = runCli(["--help", "--json"]);

    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("talent-agent");
    expect(parsed.version).toBeDefined();
    expect(parsed.modes).toBeDefined();
    expect(parsed.modes.search).toBeDefined();
    expect(parsed.modes.detail).toBeDefined();
    expect(parsed.modes.pipe).toBeDefined();
    expect(parsed.modes.interactive).toBeDefined();
    expect(parsed.modes.serve).toBeDefined();
    expect(parsed.flags).toContain("--json");
    expect(parsed.flags).toContain("--session");
    expect(parsed.envVars).toContain("TALENT_PRO_URL");
    expect(parsed.envVars).not.toContain("TALENT_PROTOCOL_API_URL");
    expect(parsed.envVars).not.toContain("TALENT_PROTOCOL_API_KEY");
    expect(exitCode).toBe(0);
  });
});

describe("CLI unknown flags", () => {
  it("exits with code 2 for unknown flags", () => {
    const { stderr, exitCode } = runCli(["--unknown-flag"]);

    expect(stderr).toContain("Unknown flag: --unknown-flag");
    expect(exitCode).toBe(2);
  });
});
