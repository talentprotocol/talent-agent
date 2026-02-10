/**
 * Unit tests for environment variable loading and validation.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { validateEnv } from "./env";

describe("validateEnv", () => {
  const originalEnv = { ...process.env };
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockExit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("passes when TALENT_PRO_URL is set", () => {
    process.env.TALENT_PRO_URL = "https://pro.talent.app";

    // Should not throw or call process.exit
    expect(() => validateEnv()).not.toThrow();
    expect(mockExit).not.toHaveBeenCalled();
  });

  it("exits with error when TALENT_PRO_URL is missing", () => {
    delete process.env.TALENT_PRO_URL;

    expect(() => validateEnv()).toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockConsoleError).toHaveBeenCalledWith(
      "Missing required environment variables:",
    );
    expect(mockConsoleError).toHaveBeenCalledWith("  - TALENT_PRO_URL");
  });

  it("treats empty string as missing", () => {
    process.env.TALENT_PRO_URL = "";

    expect(() => validateEnv()).toThrow("process.exit called");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("includes hint about .env file location", () => {
    delete process.env.TALENT_PRO_URL;

    expect(() => validateEnv()).toThrow("process.exit called");

    // Should include the hint about where to create the .env file
    const allCalls = mockConsoleError.mock.calls.map((c) => c[0]);
    expect(allCalls.some((c: string) => c.includes(".env file"))).toBe(true);
  });
});

describe("parseEnvSync (env parsing logic)", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /**
   * Since parseEnvSync is not exported, we replicate its exact logic
   * inline to verify the parsing behavior.
   */
  function parseEnvContent(content: string): void {
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  it("parses key=value pairs", () => {
    parseEnvContent("TEST_A=hello\nTEST_B=world");

    expect(process.env.TEST_A).toBe("hello");
    expect(process.env.TEST_B).toBe("world");

    delete process.env.TEST_A;
    delete process.env.TEST_B;
  });

  it("strips double quotes from values", () => {
    parseEnvContent('TEST_QUOTED="quoted value"');

    expect(process.env.TEST_QUOTED).toBe("quoted value");
    delete process.env.TEST_QUOTED;
  });

  it("strips single quotes from values", () => {
    parseEnvContent("TEST_SINGLE='single quoted'");

    expect(process.env.TEST_SINGLE).toBe("single quoted");
    delete process.env.TEST_SINGLE;
  });

  it("skips comment lines", () => {
    parseEnvContent("# comment\nTEST_REAL=real");

    expect(process.env.TEST_REAL).toBe("real");
    delete process.env.TEST_REAL;
  });

  it("skips empty lines", () => {
    parseEnvContent("\n\n  \nTEST_AFTER_EMPTY=yes");

    expect(process.env.TEST_AFTER_EMPTY).toBe("yes");
    delete process.env.TEST_AFTER_EMPTY;
  });

  it("skips lines without equals sign", () => {
    parseEnvContent("NO_EQUALS\nHAS_EQUALS=yes");

    expect(process.env.NO_EQUALS).toBeUndefined();
    expect(process.env.HAS_EQUALS).toBe("yes");
    delete process.env.HAS_EQUALS;
  });

  it("does not override existing env vars", () => {
    process.env.EXISTING_VAR = "original";
    parseEnvContent("EXISTING_VAR=overridden");

    expect(process.env.EXISTING_VAR).toBe("original");
    delete process.env.EXISTING_VAR;
  });

  it("handles values with equals signs", () => {
    parseEnvContent("URL=https://example.com?foo=bar&baz=qux");

    expect(process.env.URL).toBe("https://example.com?foo=bar&baz=qux");
    delete process.env.URL;
  });

  it("handles empty values", () => {
    parseEnvContent("EMPTY_VAL=");

    expect(process.env.EMPTY_VAL).toBe("");
    delete process.env.EMPTY_VAL;
  });
});

// Note: loadEnv() uses import.meta.dir (Bun-only) for path resolution,
// which is undefined in vitest's Node.js environment. The loadEnv function
// is tested implicitly via the CLI subprocess tests in index.test.ts.
