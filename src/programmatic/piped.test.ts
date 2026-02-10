/**
 * Unit tests for piped JSONL mode.
 */
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDetail, query } from "../agent";

// Mock the agent module
vi.mock("../agent", () => ({
  query: vi.fn(),
  getDetail: vi.fn(),
}));

describe("piped mode", () => {
  let stdoutOutput: string[];
  let originalStdin: typeof process.stdin;
  let mockStdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutOutput = [];
    mockStdoutWrite = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: any) => {
        stdoutOutput.push(String(chunk));
        return true;
      });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockStdin(lines: string[]): void {
    const readable = new Readable({
      read() {
        for (const line of lines) {
          this.push(line + "\n");
        }
        this.push(null);
      },
    });
    Object.defineProperty(process, "stdin", {
      value: readable,
      writable: true,
      configurable: true,
    });
  }

  function getOutputLines(): unknown[] {
    return stdoutOutput
      .join("")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }

  it("handles valid search action", async () => {
    createMockStdin([
      JSON.stringify({ action: "search", query: "Find React devs" }),
    ]);

    (query as any).mockResolvedValue({
      result: {
        type: "search",
        session: "s1",
        query: "Find React devs",
        profiles: [],
        totalMatches: 0,
        summary: "",
        appliedFilters: {},
      },
      meta: { durationMs: 100, tokensUsed: 500, toolsCalled: [] },
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(true);
    expect((outputs[0] as any).data.type).toBe("search");
  });

  it("handles valid detail action", async () => {
    createMockStdin([
      JSON.stringify({ action: "detail", session: "s1", index: 0 }),
    ]);

    (getDetail as any).mockResolvedValue({
      result: {
        type: "detail",
        session: "s1",
        profile: { id: "p1" } as any,
        summary: "Profile detail",
      },
      meta: { durationMs: 100, tokensUsed: 500, toolsCalled: [] },
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(true);
    expect((outputs[0] as any).data.type).toBe("detail");
  });

  it("passes request ID through to response", async () => {
    createMockStdin([
      JSON.stringify({
        action: "search",
        query: "Find devs",
        id: "req-123",
      }),
    ]);

    (query as any).mockResolvedValue({
      result: {
        type: "search",
        session: "s1",
        query: "Find devs",
        profiles: [],
        totalMatches: 0,
        summary: "",
        appliedFilters: {},
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect((outputs[0] as any).id).toBe("req-123");
  });

  it("handles legacy search format", async () => {
    createMockStdin([JSON.stringify({ query: "Find React devs" })]);

    (query as any).mockResolvedValue({
      result: {
        type: "search",
        session: "s1",
        query: "Find React devs",
        profiles: [],
        totalMatches: 0,
        summary: "",
        appliedFilters: {},
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(true);
  });

  it("handles legacy detail format", async () => {
    createMockStdin([JSON.stringify({ detail: 0, session: "s1" })]);

    (getDetail as any).mockResolvedValue({
      result: {
        type: "detail",
        session: "s1",
        profile: { id: "p1" } as any,
        summary: "",
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(true);
  });

  it("returns validation error for invalid input", async () => {
    createMockStdin([JSON.stringify({ invalid: "data" })]);

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(false);
    expect((outputs[0] as any).code).toBe("VALIDATION_ERROR");
  });

  it("skips empty lines", async () => {
    createMockStdin([
      "",
      "  ",
      JSON.stringify({ action: "search", query: "Find devs" }),
    ]);

    (query as any).mockResolvedValue({
      result: {
        type: "search",
        session: "s1",
        query: "Find devs",
        profiles: [],
        totalMatches: 0,
        summary: "",
        appliedFilters: {},
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(true);
  });

  it("handles JSON parse errors gracefully", async () => {
    createMockStdin(["not valid json"]);

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(false);
  });

  it("handles agent errors per line", async () => {
    createMockStdin([JSON.stringify({ action: "search", query: "Find devs" })]);

    (query as any).mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:9200"),
    );

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(1);
    expect((outputs[0] as any).success).toBe(false);
    expect((outputs[0] as any).code).toBe("CONNECTION_ERROR");
  });

  it("processes multiple lines sequentially", async () => {
    createMockStdin([
      JSON.stringify({ action: "search", query: "Query 1" }),
      JSON.stringify({ action: "search", query: "Query 2" }),
    ]);

    let callCount = 0;
    (query as any).mockImplementation(async (q) => {
      callCount++;
      return {
        result: {
          type: "search" as const,
          session: `s${callCount}`,
          query: q,
          profiles: [],
          totalMatches: callCount,
          summary: "",
          appliedFilters: {},
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      };
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    const outputs = getOutputLines();
    expect(outputs).toHaveLength(2);
    expect((outputs[0] as any).data.totalMatches).toBe(1);
    expect((outputs[1] as any).data.totalMatches).toBe(2);
  });

  it("passes session to search for refinement", async () => {
    createMockStdin([
      JSON.stringify({
        action: "search",
        query: "Only seniors",
        session: "existing-session",
      }),
    ]);

    (query as any).mockResolvedValue({
      result: {
        type: "search",
        session: "existing-session",
        query: "Only seniors",
        profiles: [],
        totalMatches: 0,
        summary: "",
        appliedFilters: {},
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    });

    const { runPiped } = await import("./piped");
    await runPiped();

    expect(query).toHaveBeenCalledWith("Only seniors", "existing-session", {
      debug: false,
    });
  });
});
