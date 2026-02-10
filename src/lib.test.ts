/**
 * Unit tests for the programmatic TalentSearch API.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  vi,
} from "vitest";

import { getDetail as mockGetDetail, query as mockQuery } from "./agent";
import { TalentSearch } from "./lib";

// Mock the agent module before importing lib
vi.mock("./agent", () => {
  return {
    query: vi.fn(),
    getDetail: vi.fn(),
  };
});

describe("TalentSearch", () => {
  let ts: TalentSearch;

  beforeEach(() => {
    ts = new TalentSearch();
    vi.clearAllMocks();
  });

  afterAll(() => {
    mock.restore();
  });

  describe("search", () => {
    it("returns search result and meta on success", async () => {
      const mockResult = {
        type: "search" as const,
        session: "sess-1",
        query: "Find React devs",
        profiles: [{ id: "p1", displayName: "Jane Doe" }],
        totalMatches: 1,
        summary: "Found 1 developer.",
        appliedFilters: {},
      };
      const mockMeta = {
        durationMs: 500,
        tokensUsed: 1000,
        toolsCalled: ["searchProfiles"],
      };

      (mockQuery as any).mockResolvedValue({
        result: mockResult,
        meta: mockMeta,
      });

      const response = await ts.search("Find React devs");

      expect(response.result).toEqual(mockResult);
      expect(response.meta).toEqual(mockMeta);
      expect(mockQuery).toHaveBeenCalledWith("Find React devs", undefined, {
        debug: undefined,
      });
    });

    it("passes session and debug options", async () => {
      (mockQuery as any).mockResolvedValue({
        result: {
          type: "search",
          session: "sess-1",
          query: "test",
          profiles: [],
          totalMatches: 0,
          summary: "",
          appliedFilters: {},
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await ts.search("test", { session: "my-session", debug: true });

      expect(mockQuery).toHaveBeenCalledWith("test", "my-session", {
        debug: true,
      });
    });

    it("throws when result is an error", async () => {
      (mockQuery as any).mockResolvedValue({
        result: {
          type: "error",
          session: "sess-1",
          error: "OpenSearch is down",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(ts.search("Find devs")).rejects.toThrow(
        "OpenSearch is down",
      );
    });

    it("throws when result is detail type (unexpected)", async () => {
      (mockQuery as any).mockResolvedValue({
        result: {
          type: "detail",
          session: "sess-1",
          profile: {} as any,
          summary: "",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(ts.search("Find devs")).rejects.toThrow(
        "Unexpected result type: detail",
      );
    });
  });

  describe("detail", () => {
    it("returns detail result and meta on success", async () => {
      const mockResult = {
        type: "detail" as const,
        session: "sess-1",
        profile: {
          id: "p1",
          displayName: "Jane Doe",
          mainRole: "Engineer",
        } as any,
        summary: "Profile details for Jane Doe.",
      };
      const mockMeta = {
        durationMs: 300,
        tokensUsed: 800,
        toolsCalled: ["getProfileDetails"],
      };

      (mockGetDetail as any).mockResolvedValue({
        result: mockResult,
        meta: mockMeta,
      });

      const response = await ts.detail("sess-1", 0);

      expect(response.result).toEqual(mockResult);
      expect(response.meta).toEqual(mockMeta);
      expect(mockGetDetail).toHaveBeenCalledWith("sess-1", 0, {
        debug: undefined,
      });
    });

    it("passes debug option", async () => {
      (mockGetDetail as any).mockResolvedValue({
        result: {
          type: "detail",
          session: "sess-1",
          profile: {} as any,
          summary: "",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await ts.detail("sess-1", 2, { debug: true });

      expect(mockGetDetail).toHaveBeenCalledWith("sess-1", 2, { debug: true });
    });

    it("throws when result is an error", async () => {
      (mockGetDetail as any).mockResolvedValue({
        result: {
          type: "error",
          session: "sess-1",
          error: "No search results in this session.",
          code: "SESSION_NOT_FOUND",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(ts.detail("sess-1", 0)).rejects.toThrow(
        "No search results in this session.",
      );
    });

    it("throws when result is search type (unexpected)", async () => {
      (mockGetDetail as any).mockResolvedValue({
        result: {
          type: "search",
          session: "sess-1",
          query: "test",
          profiles: [],
          totalMatches: 0,
          summary: "",
          appliedFilters: {},
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(ts.detail("sess-1", 0)).rejects.toThrow(
        "Unexpected result type: search",
      );
    });
  });

  describe("refine", () => {
    it("returns refined search result on success", async () => {
      const mockResult = {
        type: "search" as const,
        session: "sess-1",
        query: "Only seniors",
        profiles: [{ id: "p2", displayName: "Senior Dev" }],
        totalMatches: 5,
        summary: "Refined results.",
        appliedFilters: {},
      };
      const mockMeta = {
        durationMs: 400,
        tokensUsed: 900,
        toolsCalled: ["searchProfiles"],
      };

      (mockQuery as any).mockResolvedValue({
        result: mockResult,
        meta: mockMeta,
      });

      const response = await ts.refine("sess-1", "Only seniors");

      expect(response.result).toEqual(mockResult);
      expect(response.meta).toEqual(mockMeta);
      expect(mockQuery).toHaveBeenCalledWith("Only seniors", "sess-1", {
        debug: undefined,
      });
    });

    it("throws when result is an error", async () => {
      (mockQuery as any).mockResolvedValue({
        result: {
          type: "error",
          session: "sess-1",
          error: "Rate limit hit",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(ts.refine("sess-1", "Only seniors")).rejects.toThrow(
        "Rate limit hit",
      );
    });

    it("throws when result is detail type (unexpected)", async () => {
      (mockQuery as any).mockResolvedValue({
        result: {
          type: "detail",
          session: "sess-1",
          profile: {} as any,
          summary: "",
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await expect(ts.refine("sess-1", "Only seniors")).rejects.toThrow(
        "Unexpected result type: detail",
      );
    });

    it("passes debug option", async () => {
      (mockQuery as any).mockResolvedValue({
        result: {
          type: "search",
          session: "sess-1",
          query: "test",
          profiles: [],
          totalMatches: 0,
          summary: "",
          appliedFilters: {},
        },
        meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
      });

      await ts.refine("sess-1", "Only seniors", { debug: true });

      expect(mockQuery).toHaveBeenCalledWith("Only seniors", "sess-1", {
        debug: true,
      });
    });
  });
});
