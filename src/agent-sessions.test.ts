/**
 * Unit tests for agent session management, query, and getDetail.
 *
 * Tests session CRUD, persistence (save/load), and the main query/getDetail
 * flows using mocked fetch (remote API) + mocked getValidToken (auth store).
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSession,
  getAllSessions,
  getDetail,
  getOrCreateSession,
  getSession,
  loadSession,
  query,
  saveSession,
} from "./agent";

// Mock the auth store so query() gets a valid token
vi.mock("./auth/store", () => ({
  getValidToken: vi.fn().mockResolvedValue("mock-token"),
}));

// Mock the errors module to avoid dependency issues
vi.mock("./errors", () => ({
  toAIFriendlyError: vi.fn((err: unknown) => ({
    message: err instanceof Error ? err.message : String(err),
    code: "UNKNOWN",
  })),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a fake AI SDK UI message stream body string.
 * Format: TYPE_CODE:JSON_DATA per line.
 */
function buildStreamBody(parts: {
  textParts?: string[];
  toolCalls?: { toolCallId: string; toolName: string; args: unknown }[];
  toolResults?: { toolCallId: string; result: unknown }[];
  error?: string;
}): string {
  const lines: string[] = [];

  for (const tc of parts.toolCalls ?? []) {
    lines.push(`9:${JSON.stringify(tc)}`);
  }
  for (const text of parts.textParts ?? []) {
    lines.push(`0:${JSON.stringify(text)}`);
  }
  for (const tr of parts.toolResults ?? []) {
    lines.push(`a:${JSON.stringify(tr)}`);
  }
  if (parts.error) {
    lines.push(`3:${JSON.stringify(parts.error)}`);
  }
  lines.push(`d:${JSON.stringify({ finishReason: "stop" })}`);

  return lines.join("\n") + "\n";
}

function mockFetchResponse(body: string, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

// ─── Setup ──────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TALENT_PRO_URL = "http://localhost:3000";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("session management", () => {
  it("createSession returns a string id", () => {
    const id = createSession();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("createSession creates unique sessions", () => {
    const id1 = createSession();
    const id2 = createSession();
    expect(id1).not.toBe(id2);
  });

  it("getSession returns the created session", () => {
    const id = createSession();
    const session = getSession(id);

    expect(session).toBeDefined();
    expect(session!.id).toBe(id);
    expect(session!.messages).toEqual([]);
    expect(session!.lastResult).toBeNull();
  });

  it("getSession returns undefined for non-existent session", () => {
    const session = getSession("non-existent-id");
    expect(session).toBeUndefined();
  });

  it("getOrCreateSession returns existing session when id matches", () => {
    const id = createSession();
    const session = getOrCreateSession(id);

    expect(session.id).toBe(id);
  });

  it("getOrCreateSession creates new session when id not found", () => {
    const session = getOrCreateSession("new-id");

    expect(session.id).toBe("new-id");
    expect(session.messages).toEqual([]);
  });

  it("getOrCreateSession creates new session with random id when no id given", () => {
    const session = getOrCreateSession();

    expect(session.id).toBeTruthy();
    expect(session.messages).toEqual([]);
  });

  it("getAllSessions returns all sessions", () => {
    const initialCount = getAllSessions().length;
    createSession();
    createSession();

    const sessions = getAllSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(initialCount + 2);
  });
});

describe("session persistence", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "talent-agent-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it("saveSession writes session data to file", () => {
    const id = createSession();
    const filePath = join(tmpDir, "session.json");

    saveSession(id, filePath);

    const content = readFileSync(filePath, "utf-8");
    const data = JSON.parse(content);

    expect(data.id).toBe(id);
    expect(data.messages).toEqual([]);
    expect(data.lastResult).toBeNull();
  });

  it("saveSession throws for non-existent session", () => {
    const filePath = join(tmpDir, "session.json");

    expect(() => saveSession("nonexistent", filePath)).toThrow(
      'Session "nonexistent" not found',
    );
  });

  it("loadSession loads session from file and returns session id", () => {
    const sessionData = {
      id: "loaded-session",
      messages: [
        { role: "user", parts: [{ type: "text", text: "Find React devs" }] },
      ],
      lastResult: null,
    };

    const filePath = join(tmpDir, "session.json");
    writeFileSync(filePath, JSON.stringify(sessionData), "utf-8");

    const loadedId = loadSession(filePath);

    expect(loadedId).toBe("loaded-session");

    // Verify session is accessible
    const session = getSession("loaded-session");
    expect(session).toBeDefined();
    expect(session!.messages).toHaveLength(1);
  });

  it("round-trips a session through save and load", () => {
    const id = createSession();
    const session = getSession(id)!;

    // Add some data to the session
    session.messages.push({
      role: "user",
      parts: [{ type: "text", text: "Test query" }],
    } as any);
    session.messages.push({
      role: "assistant",
      parts: [{ type: "text", text: "Test response" }],
    } as any);
    session.lastResult = {
      type: "search",
      session: id,
      query: "Test query",
      profiles: [],
      totalMatches: 0,
      summary: "No results",
      appliedFilters: {},
    };

    const filePath = join(tmpDir, "round-trip.json");
    saveSession(id, filePath);

    const loadedId = loadSession(filePath);
    const loadedSession = getSession(loadedId)!;

    expect(loadedSession.messages).toHaveLength(2);
    expect(loadedSession.lastResult).not.toBeNull();
    expect(loadedSession.lastResult!.type).toBe("search");
  });
});

describe("query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends query to remote API and returns structured search result", async () => {
    const body = buildStreamBody({
      toolCalls: [
        {
          toolCallId: "tc-1",
          toolName: "searchProfiles",
          args: { query: "Find React devs" },
        },
      ],
      toolResults: [
        {
          toolCallId: "tc-1",
          result: {
            profiles: [{ id: "p1", displayName: "Jane Doe" }],
            totalMatches: 1,
            appliedFilters: {},
          },
        },
      ],
      textParts: ["Found 1 developer."],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetchResponse(body));

    const result = await query("Find React devs");

    expect(result.result.type).toBe("search");
    expect(result.meta.toolsCalled).toContain("searchProfiles");
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("stores messages in session history", async () => {
    const body = buildStreamBody({
      textParts: ["Response text"],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetchResponse(body));

    const sessionId = createSession();
    await query("Test query", sessionId);

    const session = getSession(sessionId)!;
    expect(session.messages).toHaveLength(2); // user + assistant
    expect(session.messages[0]!.role).toBe("user");
    expect(session.messages[1]!.role).toBe("assistant");
  });

  it("returns error result when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch failed"));

    const result = await query("Find devs");

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("fetch failed");
    }
  });

  it("returns error result when not authenticated", async () => {
    const { getValidToken } = await import("./auth/store");
    vi.mocked(getValidToken).mockResolvedValueOnce(null);

    const result = await query("Find devs");

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("Not authenticated");
      expect(result.result.code).toBe("AUTH_ERROR");
    }
  });

  it("creates a new session when none is provided", async () => {
    const body = buildStreamBody({ textParts: ["ok"] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetchResponse(body));

    const result = await query("Test");

    expect(result.result.session).toBeTruthy();
  });

  it("uses existing session when sessionId is provided", async () => {
    const body = buildStreamBody({ textParts: ["ok"] });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetchResponse(body));

    const sessionId = createSession();
    const result = await query("Test", sessionId);

    expect(result.result.session).toBe(sessionId);
  });

  it("returns error when API responds with non-200 status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await query("Find devs");

    expect(result.result.type).toBe("error");
  });
});

describe("getDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when session has no search results", async () => {
    const sessionId = createSession();
    const result = await getDetail(sessionId, 0);

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("No search results");
      expect(result.result.code).toBe("SESSION_NOT_FOUND");
    }
  });

  it("returns error when session does not exist", async () => {
    const result = await getDetail("nonexistent", 0);

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.code).toBe("SESSION_NOT_FOUND");
    }
  });

  it("returns error when profile index is out of range", async () => {
    // Create a session with search results
    const searchBody = buildStreamBody({
      toolCalls: [{ toolCallId: "tc-1", toolName: "searchProfiles", args: {} }],
      toolResults: [
        {
          toolCallId: "tc-1",
          result: {
            profiles: [{ id: "p1", displayName: "Jane" }],
            totalMatches: 1,
          },
        },
      ],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      mockFetchResponse(searchBody),
    );

    const sessionId = createSession();
    await query("Find devs", sessionId);

    // Now try to get detail at an out-of-range index
    const result = await getDetail(sessionId, 5);

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("out of range");
      expect(result.result.code).toBe("INDEX_OUT_OF_RANGE");
    }
  });

  it("sends detail request to agent for valid index", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // First call: search results
    const searchBody = buildStreamBody({
      toolCalls: [{ toolCallId: "tc-1", toolName: "searchProfiles", args: {} }],
      toolResults: [
        {
          toolCallId: "tc-1",
          result: {
            profiles: [{ id: "p1", displayName: "Jane Doe", name: "Jane Doe" }],
            totalMatches: 1,
          },
        },
      ],
    });

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(searchBody));

    const sessionId = createSession();
    await query("Find devs", sessionId);

    // Second call: detail response
    const detailBody = buildStreamBody({
      toolCalls: [
        {
          toolCallId: "tc-2",
          toolName: "getProfileDetails",
          args: { profileId: "p1" },
        },
      ],
      toolResults: [
        {
          toolCallId: "tc-2",
          result: {
            success: true,
            profile: {
              id: "p1",
              displayName: "Jane Doe",
              mainRole: "Engineer",
            },
          },
        },
      ],
    });

    fetchSpy.mockResolvedValueOnce(mockFetchResponse(detailBody));

    const result = await getDetail(sessionId, 0);

    expect(result.result.type).toBe("detail");
    // The fetch should have been called twice (search + detail)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("extractToolNames (via query meta)", () => {
  it("extracts tool names from stream response", async () => {
    const body = buildStreamBody({
      toolCalls: [
        { toolCallId: "tc-1", toolName: "searchProfiles", args: {} },
        { toolCallId: "tc-2", toolName: "getProfileDetails", args: {} },
      ],
      toolResults: [
        { toolCallId: "tc-1", result: { profiles: [] } },
        { toolCallId: "tc-2", result: { success: true, profile: {} } },
      ],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetchResponse(body));

    const result = await query("Test");
    expect(result.meta.toolsCalled).toEqual([
      "searchProfiles",
      "getProfileDetails",
    ]);
  });

  it("returns empty array when no tool calls", async () => {
    const body = buildStreamBody({
      textParts: ["Just text"],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValue(mockFetchResponse(body));

    const result = await query("Test");
    expect(result.meta.toolsCalled).toEqual([]);
  });
});
