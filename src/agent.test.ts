/**
 * Unit tests for agent result building and tool extraction.
 */
import { describe, expect, it } from "vitest";

import { buildResult, extractToolResults } from "./agent";
import type { DetailResult, ErrorResult, SearchResult } from "./agent";

describe("buildResult", () => {
  it("returns search result when searchProfiles tool is present", () => {
    const toolResults = [
      {
        toolName: "searchProfiles",
        result: {
          profiles: [
            { id: "p1", displayName: "Jane Doe", mainRole: "Engineer" },
          ],
          totalMatches: 1,
          appliedFilters: { languages: ["TypeScript"] },
        },
      },
    ];

    const result = buildResult(
      "session-1",
      "Find TypeScript developers",
      "Found 1 developer.",
      toolResults,
    );

    expect(result.type).toBe("search");
    const searchResult = result as SearchResult;
    expect(searchResult.profiles).toHaveLength(1);
    expect(searchResult.profiles[0]!.displayName).toBe("Jane Doe");
    expect(searchResult.totalMatches).toBe(1);
    expect(searchResult.summary).toBe("Found 1 developer.");
    expect(searchResult.session).toBe("session-1");
  });

  it("returns detail result when getProfileDetails tool is present", () => {
    const toolResults = [
      {
        toolName: "getProfileDetails",
        result: {
          success: true,
          profile: {
            id: "p1",
            displayName: "Jane Doe",
            mainRole: "Frontend Engineer",
            location: "Berlin",
          },
        },
      },
    ];

    const result = buildResult(
      "session-1",
      "Show profile details",
      "Here are the details.",
      toolResults,
    );

    expect(result.type).toBe("detail");
    const detailResult = result as DetailResult;
    expect(detailResult.profile.displayName).toBe("Jane Doe");
    expect(detailResult.summary).toBe("Here are the details.");
  });

  it("returns search result when searchInTable tool is present", () => {
    const toolResults = [
      {
        toolName: "searchInTable",
        result: {
          profiles: [{ id: "p1", name: "Test User" }],
          matchCount: 5,
        },
      },
    ];

    const result = buildResult(
      "session-1",
      "Search in table",
      "Found results.",
      toolResults,
    );

    expect(result.type).toBe("search");
    const searchResult = result as SearchResult;
    expect(searchResult.profiles).toHaveLength(1);
    expect(searchResult.totalMatches).toBe(5);
  });

  it("returns empty search result when no tool results", () => {
    const result = buildResult(
      "session-1",
      "Some query",
      "No results found.",
      [],
    );

    expect(result.type).toBe("search");
    const searchResult = result as SearchResult;
    expect(searchResult.profiles).toHaveLength(0);
    expect(searchResult.totalMatches).toBe(0);
    expect(searchResult.summary).toBe("No results found.");
  });

  it("prioritizes getProfileDetails over searchProfiles", () => {
    const toolResults = [
      {
        toolName: "searchProfiles",
        result: { profiles: [{ id: "p1" }], totalMatches: 1 },
      },
      {
        toolName: "getProfileDetails",
        result: {
          success: true,
          profile: { id: "p1", displayName: "Jane Doe" },
        },
      },
    ];

    const result = buildResult("session-1", "query", "text", toolResults);
    expect(result.type).toBe("detail");
  });
});

describe("extractToolResults", () => {
  it("extracts tool results from response steps", () => {
    const mockResponse = {
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "searchProfiles",
              input: { query: "React devs" },
            },
          ],
        },
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "tc-1",
              output: { profiles: [], totalMatches: 0 },
            },
          ],
        },
      ],
    };

    const results = extractToolResults(mockResponse as any);

    expect(results).toHaveLength(1);
    expect(results[0]!.toolName).toBe("searchProfiles");
    expect(results[0]!.result).toEqual({ profiles: [], totalMatches: 0 });
  });

  it("returns empty array when no steps", () => {
    const results = extractToolResults({} as any);
    expect(results).toHaveLength(0);
  });

  it("handles multiple tool calls", () => {
    const mockResponse = {
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "searchProfiles",
              input: {},
            },
            {
              type: "tool-call",
              toolCallId: "tc-2",
              toolName: "getProfileDetails",
              input: {},
            },
          ],
        },
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "tc-1",
              output: { profiles: [] },
            },
            {
              type: "tool-result",
              toolCallId: "tc-2",
              output: { success: true, profile: {} },
            },
          ],
        },
      ],
    };

    const results = extractToolResults(mockResponse as any);

    expect(results).toHaveLength(2);
    expect(results[0]!.toolName).toBe("searchProfiles");
    expect(results[1]!.toolName).toBe("getProfileDetails");
  });
});
