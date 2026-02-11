/**
 * Unit tests for terminal formatters.
 */
import { beforeAll, describe, expect, it } from "vitest";

import type { AgentResult, DetailResult, SearchResult } from "./agent";

// Set NO_COLOR before importing format to test without ANSI codes
beforeAll(() => {
  process.env.NO_COLOR = "1";
});

// Dynamic import after setting env
const { formatSearchResult, formatDetailResult, formatError, toJSON } =
  await import("./format");

describe("formatSearchResult", () => {
  it("formats a search result with profiles", () => {
    const result: SearchResult = {
      type: "search",
      session: "test-session",
      query: "Find React developers",
      profiles: [
        {
          id: "p1",
          displayName: "Jane Doe",
          mainRole: "Frontend Engineer",
          location: "Lisbon",
          githubTopLanguages: ["TypeScript", "JavaScript"],
        },
        {
          id: "p2",
          name: "John Smith",
          mainRole: "Full-Stack Developer",
          location: "London",
          githubTopLanguages: "Python",
        },
      ],
      totalMatches: 42,
      summary: "Found 42 React developers.",
      appliedFilters: { languages: ["React"] },
    };

    const output = formatSearchResult(result);

    expect(output).toContain("Find React developers");
    expect(output).toContain("42 total matches");
    expect(output).toContain("Jane Doe");
    expect(output).toContain("John Smith");
    expect(output).toContain("Frontend Engineer");
    expect(output).toContain("Lisbon");
    expect(output).toContain("test-session");
  });

  it("formats a search result with no profiles", () => {
    const result: SearchResult = {
      type: "search",
      session: "test-session",
      query: "Find Cobol developers",
      profiles: [],
      totalMatches: 0,
      summary: "No profiles found.",
      appliedFilters: {},
    };

    const output = formatSearchResult(result);

    expect(output).toContain("No profiles found");
    expect(output).toContain("0 total matches");
  });
});

describe("formatDetailResult", () => {
  it("formats a detail result", () => {
    const result: DetailResult = {
      type: "detail",
      session: "test-session",
      profile: {
        id: "p1",
        displayName: "Jane Doe",
        name: "Jane Doe",
        mainRole: "Frontend Engineer",
        location: "Lisbon, Portugal",
        bio: "Passionate React developer.",
        tags: ["React", "TypeScript"],
        github: {
          topLanguages: "TypeScript, JavaScript",
          topFrameworks: "React, Next.js",
          expertiseLevel: "Senior",
          totalContributions: 1234,
          isRecentlyActive: true,
        },
        linkedin: {
          currentTitle: "Senior Frontend Engineer",
          currentCompany: "TechCorp",
          totalYearsExperience: 8,
        },
        workExperience: [
          {
            title: "Senior Frontend Engineer",
            company: "TechCorp",
            isCurrent: true,
            durationMonths: 24,
          },
        ],
        education: [
          {
            school: "MIT",
            degree: "BSc",
            fieldOfStudy: "Computer Science",
            startYear: 2010,
            endYear: 2014,
          },
        ],
      } as any,
      summary: "Detailed profile for Jane Doe.",
    };

    const output = formatDetailResult(result);

    expect(output).toContain("Jane Doe");
    expect(output).toContain("Frontend Engineer");
    expect(output).toContain("Lisbon, Portugal");
    expect(output).toContain("React");
    expect(output).toContain("TypeScript");
    expect(output).toContain("GitHub");
    expect(output).toContain("LinkedIn");
    expect(output).toContain("TechCorp");
    expect(output).toContain("test-session");
  });
});

describe("formatError", () => {
  it("formats an error message", () => {
    const output = formatError("Something went wrong");

    expect(output).toContain("Error:");
    expect(output).toContain("Something went wrong");
  });

  it("includes session when provided", () => {
    const output = formatError("Something went wrong", "sess-123");

    expect(output).toContain("Session: sess-123");
  });
});

describe("toJSON", () => {
  it("serializes a search result to JSON", () => {
    const result: AgentResult = {
      type: "search",
      session: "s1",
      query: "test",
      profiles: [],
      totalMatches: 0,
      summary: "",
      appliedFilters: {},
    };

    const json = toJSON(result);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe("search");
    expect(parsed.session).toBe("s1");
  });

  it("serializes an error result to JSON", () => {
    const result: AgentResult = {
      type: "error",
      session: "s1",
      error: "test error",
    };

    const json = toJSON(result);
    const parsed = JSON.parse(json);

    expect(parsed.type).toBe("error");
    expect(parsed.error).toBe("test error");
  });
});
