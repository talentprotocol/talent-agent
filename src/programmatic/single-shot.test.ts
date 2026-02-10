/**
 * Unit tests for single-shot mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getDetail, query } from "../agent";
import { formatDetailResult, formatError, formatSearchResult } from "../format";

// Mock dependencies
vi.mock("../agent", () => ({
  query: vi.fn(),
  getDetail: vi.fn(),
}));

vi.mock("../format", () => ({
  formatSearchResult: vi.fn(() => "formatted-search"),
  formatDetailResult: vi.fn(() => "formatted-detail"),
  formatError: vi.fn((msg: string) => `Error: ${msg}`),
  toJSON: vi.fn(() => "{}"),
}));

// Import after mocks
const { runSingleShot } = await import("./single-shot");

describe("runSingleShot", () => {
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;
  let mockProcessExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    mockConsoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockProcessExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("search mode (no detailIndex)", () => {
    it("prints formatted search results", async () => {
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
        meta: { durationMs: 100, tokensUsed: 500, toolsCalled: [] },
      });

      await runSingleShot("Find devs");

      expect(query).toHaveBeenCalledWith("Find devs", undefined, {
        debug: false,
      });
      expect(formatSearchResult).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith("formatted-search");
    });

    it("prints formatted detail results when agent returns detail", async () => {
      (query as any).mockResolvedValue({
        result: {
          type: "detail",
          session: "s1",
          profile: { id: "p1" } as any,
          summary: "Detail",
        },
        meta: { durationMs: 100, tokensUsed: 500, toolsCalled: [] },
      });

      await runSingleShot("Show profile");

      expect(formatDetailResult).toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith("formatted-detail");
    });

    it("prints error and exits with EXIT_APP_ERROR on error result", async () => {
      (query as any).mockResolvedValue({
        result: {
          type: "error",
          session: "s1",
          error: "Something failed",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(runSingleShot("Find devs")).rejects.toThrow("process.exit");

      expect(formatError).toHaveBeenCalledWith("Something failed", "s1");
      expect(mockProcessExit).toHaveBeenCalledWith(1);
    });
  });

  describe("detail mode (with detailIndex and sessionId)", () => {
    it("calls getDetail when detailIndex and sessionId provided", async () => {
      (getDetail as any).mockResolvedValue({
        result: {
          type: "detail",
          session: "s1",
          profile: { id: "p1" } as any,
          summary: "Details",
        },
        meta: { durationMs: 100, tokensUsed: 500, toolsCalled: [] },
      });

      await runSingleShot("ignored query", "s1", 0);

      expect(getDetail).toHaveBeenCalledWith("s1", 0, { debug: false });
      expect(query).not.toHaveBeenCalled();
      expect(formatDetailResult).toHaveBeenCalled();
    });
  });

  describe("JSON output", () => {
    it("wraps successful search result in JSON envelope", async () => {
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
        meta: {
          durationMs: 100,
          tokensUsed: 500,
          toolsCalled: ["searchProfiles"],
        },
      });

      await runSingleShot("Find devs", undefined, undefined, true);

      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      const output = JSON.parse(mockConsoleLog.mock.calls[0]![0]);
      expect(output.success).toBe(true);
      expect(output.data.type).toBe("search");
      expect(output.meta.durationMs).toBe(100);
      expect(output.meta.tokensUsed).toBe(500);
      expect(output.meta.toolsCalled).toEqual(["searchProfiles"]);
    });

    it("wraps error result in JSON error envelope", async () => {
      (query as any).mockResolvedValue({
        result: {
          type: "error",
          session: "s1",
          error: "connect ECONNREFUSED 127.0.0.1:9200",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(
        runSingleShot("Find devs", undefined, undefined, true),
      ).rejects.toThrow("process.exit");

      const output = JSON.parse(mockConsoleLog.mock.calls[0]![0]);
      expect(output.success).toBe(false);
      expect(output.error).toBeDefined();
      expect(output.code).toBeDefined();
    });
  });

  describe("exception handling", () => {
    it("catches thrown errors and outputs formatted error", async () => {
      (query as any).mockRejectedValue(new Error("Network failure"));

      await expect(runSingleShot("Find devs")).rejects.toThrow("process.exit");

      expect(formatError).toHaveBeenCalled();
      expect(mockProcessExit).toHaveBeenCalled();
    });

    it("catches thrown errors and outputs JSON error envelope in json mode", async () => {
      (query as any).mockRejectedValue(
        new Error("connect ECONNREFUSED 127.0.0.1:9200"),
      );

      await expect(
        runSingleShot("Find devs", undefined, undefined, true),
      ).rejects.toThrow("process.exit");

      const output = JSON.parse(mockConsoleLog.mock.calls[0]![0]);
      expect(output.success).toBe(false);
      expect(output.error).toContain("Cannot connect");
      expect(output.code).toBe("CONNECTION_ERROR");
    });
  });

  describe("debug flag", () => {
    it("passes debug option to query", async () => {
      (query as any).mockResolvedValue({
        result: {
          type: "search",
          session: "s1",
          query: "test",
          profiles: [],
          totalMatches: 0,
          summary: "",
          appliedFilters: {},
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await runSingleShot("test", undefined, undefined, false, true);

      expect(query).toHaveBeenCalledWith("test", undefined, { debug: true });
    });
  });

  describe("session passthrough", () => {
    it("passes session to query for refinement", async () => {
      (query as any).mockResolvedValue({
        result: {
          type: "search",
          session: "s1",
          query: "Only seniors",
          profiles: [],
          totalMatches: 0,
          summary: "",
          appliedFilters: {},
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await runSingleShot("Only seniors", "my-session");

      expect(query).toHaveBeenCalledWith("Only seniors", "my-session", {
        debug: false,
      });
    });
  });
});
