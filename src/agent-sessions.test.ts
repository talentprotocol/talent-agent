/**
 * Unit tests for agent session management, query, and getDetail.
 *
 * Tests session CRUD and the main query/getDetail flows using mocked fetch
 * (remote API) + mocked getValidToken (auth store).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSession,
  getAllSessions,
  getDetail,
  getOrCreateSession,
  getSession,
  query,
} from "./agent";

// Use vi.spyOn instead of vi.mock to avoid cross-file mock contamination.
// vi.mock leaks across test files in Bun 1.x and mock.restore() does not clear it.
// vi.spyOn + mockRestore properly cleans up after each test.
let getValidTokenSpy: ReturnType<typeof vi.spyOn> | undefined;
let toAIFriendlyErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a fake AI SDK UI message stream body string.
 * Format: SSE with "data: {JSON}" lines.
 */
function buildStreamBody(parts: {
  textParts?: string[];
  toolCalls?: { toolCallId: string; toolName: string; args: unknown }[];
  toolResults?: { toolCallId: string; result: unknown }[];
  error?: string;
}): string {
  const lines: string[] = [];

  lines.push(`data: ${JSON.stringify({ type: "start" })}`);
  lines.push(`data: ${JSON.stringify({ type: "start-step" })}`);

  for (const tc of parts.toolCalls ?? []) {
    lines.push(
      `data: ${JSON.stringify({ type: "tool-input-available", toolCallId: tc.toolCallId, toolName: tc.toolName, input: tc.args })}`,
    );
  }
  for (const tr of parts.toolResults ?? []) {
    lines.push(
      `data: ${JSON.stringify({ type: "tool-output-available", toolCallId: tr.toolCallId, output: tr.result })}`,
    );
  }
  for (const text of parts.textParts ?? []) {
    lines.push(
      `data: ${JSON.stringify({ type: "text-delta", id: "0", delta: text })}`,
    );
  }
  if (parts.error) {
    lines.push(
      `data: ${JSON.stringify({ type: "error", message: parts.error })}`,
    );
  }
  lines.push(`data: ${JSON.stringify({ type: "finish-step" })}`);
  lines.push(
    `data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}`,
  );
  lines.push("data: [DONE]");

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

/** Default server session ID returned by the mock session creation endpoint. */
const MOCK_SERVER_SESSION_ID = 999;

/**
 * Create a fetch mock that routes by URL:
 * - POST /api/ai-chat/sessions -> returns a new server session
 * - POST /api/ai-chat/sessions/.../messages/bulk -> returns 200 (persistence)
 * - GET  /api/ai-chat/sessions/... -> returns session with no messages
 * - POST /api/chat -> returns the given SSE stream body
 * - GET  /api/profile/.../detail -> returns the given detail response
 *
 * For tests that need custom behavior, pass overrides.
 */
function mockRoutedFetch(
  chatStreamBody: string,
  overrides?: {
    detailResponse?: Response;
    chatResponse?: Response;
    sessionCreateResponse?: Response;
  },
) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      // Session creation
      if (url.includes("/api/ai-chat/sessions") && !url.includes("/messages")) {
        if (overrides?.sessionCreateResponse)
          return overrides.sessionCreateResponse;
        // POST (create) or GET (fetch)
        return new Response(
          JSON.stringify({
            session: {
              id: MOCK_SERVER_SESSION_ID,
              title: null,
              status: "active",
              model_id: "gpt-4o",
              metadata: {},
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              messages: [],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      // Message persistence (fire-and-forget)
      if (url.includes("/messages/bulk")) {
        return new Response(JSON.stringify({ messages: [] }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }

      // Profile detail
      if (url.includes("/api/profile/") && url.includes("/detail")) {
        if (overrides?.detailResponse) return overrides.detailResponse;
        return new Response("{}", { status: 404 });
      }

      // Chat API (default)
      if (url.includes("/api/chat")) {
        if (overrides?.chatResponse) return overrides.chatResponse;
        return mockFetchResponse(chatStreamBody);
      }

      return new Response("Not found", { status: 404 });
    });
}

// ─── Setup ──────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(async () => {
  process.env.TALENT_PRO_URL = "http://localhost:3000";

  // Spy on auth store and errors modules (ESM live bindings propagate to ./agent)
  const store = await import("./auth/store");
  const errors = await import("./errors");

  getValidTokenSpy = vi
    .spyOn(store, "getValidToken")
    .mockResolvedValue("mock-token" as any);
  toAIFriendlyErrorSpy = vi
    .spyOn(errors, "toAIFriendlyError")
    .mockImplementation(
      (err: unknown) =>
        ({
          message: err instanceof Error ? err.message : String(err),
          code: "UNKNOWN",
        }) as any,
    );
});

afterEach(() => {
  process.env = { ...originalEnv };
  getValidTokenSpy?.mockRestore();
  toAIFriendlyErrorSpy?.mockRestore();
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

    mockRoutedFetch(body);

    const result = await query("Find React devs");

    expect(result.result.type).toBe("search");
    expect(result.meta.toolsCalled).toContain("searchProfiles");
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("stores messages in session history", async () => {
    const body = buildStreamBody({
      textParts: ["Response text"],
    });

    mockRoutedFetch(body);

    const sessionId = createSession();
    await query("Test query", sessionId);

    const session = getSession(sessionId)!;
    expect(session.messages).toHaveLength(2); // user + assistant
    expect(session.messages[0]!.role).toBe("user");
    expect(session.messages[1]!.role).toBe("assistant");
  });

  it("returns error result when not authenticated", async () => {
    const { getValidToken } = await import("./auth/store");
    (getValidToken as any).mockResolvedValueOnce(null);

    const result = await query("Find devs");

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("Not authenticated");
      expect(result.result.code).toBe("AUTH_ERROR");
    }
  });

  it("creates a server session when none is provided", async () => {
    const body = buildStreamBody({ textParts: ["ok"] });
    mockRoutedFetch(body);

    const result = await query("Test");

    // Session ID should be the server-assigned numeric ID
    expect(result.result.session).toBe(String(MOCK_SERVER_SESSION_ID));
  });

  it("uses existing cached session when sessionId is provided", async () => {
    const body = buildStreamBody({ textParts: ["ok"] });
    mockRoutedFetch(body);

    const sessionId = createSession();
    const result = await query("Test", sessionId);

    expect(result.result.session).toBe(sessionId);
  });

  it("returns error when chat API responds with non-200 status", async () => {
    mockRoutedFetch("", {
      chatResponse: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const sessionId = createSession();
    const result = await query("Find devs", sessionId);

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

    mockRoutedFetch(searchBody);

    const sessionId = createSession();
    await query("Find devs", sessionId);

    const result = await getDetail(sessionId, 5);

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("out of range");
      expect(result.result.code).toBe("INDEX_OUT_OF_RANGE");
    }
  });

  it("sends detail request to the detail endpoint for valid index", async () => {
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

    const fetchSpy = mockRoutedFetch(searchBody, {
      detailResponse: new Response(
        JSON.stringify({
          profile: {
            id: "p1",
            displayName: "Jane Doe",
            mainRole: "Engineer",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    });

    const sessionId = createSession();
    await query("Find devs", sessionId);

    const result = await getDetail(sessionId, 0);

    expect(result.result.type).toBe("detail");
    if (result.result.type === "detail") {
      expect(result.result.profile.displayName).toBe("Jane Doe");
      expect(result.result.profile.mainRole).toBe("Engineer");
    }
  });

  it("returns error when detail endpoint returns 404", async () => {
    const searchBody = buildStreamBody({
      toolCalls: [{ toolCallId: "tc-1", toolName: "searchProfiles", args: {} }],
      toolResults: [
        {
          toolCallId: "tc-1",
          result: {
            profiles: [{ id: "p1", displayName: "Jane Doe" }],
            totalMatches: 1,
          },
        },
      ],
    });

    mockRoutedFetch(searchBody, {
      detailResponse: new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      ),
    });

    const sessionId = createSession();
    await query("Find devs", sessionId);

    const result = await getDetail(sessionId, 0);

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("Profile not found");
    }
  });

  it("returns error when not authenticated for detail", async () => {
    const searchBody = buildStreamBody({
      toolCalls: [{ toolCallId: "tc-1", toolName: "searchProfiles", args: {} }],
      toolResults: [
        {
          toolCallId: "tc-1",
          result: {
            profiles: [{ id: "p1", displayName: "Jane Doe" }],
            totalMatches: 1,
          },
        },
      ],
    });

    mockRoutedFetch(searchBody);

    const sessionId = createSession();
    await query("Find devs", sessionId);

    // Now mock token as null for the detail call
    const { getValidToken } = await import("./auth/store");
    (getValidToken as any).mockResolvedValueOnce(null);

    const result = await getDetail(sessionId, 0);

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("Not authenticated");
      expect(result.result.code).toBe("AUTH_ERROR");
    }
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

    mockRoutedFetch(body);

    const sessionId = createSession();
    const result = await query("Test", sessionId);
    expect(result.meta.toolsCalled).toEqual([
      "searchProfiles",
      "getProfileDetails",
    ]);
  });

  it("returns empty array when no tool calls", async () => {
    const body = buildStreamBody({
      textParts: ["Just text"],
    });

    mockRoutedFetch(body);

    const sessionId = createSession();
    const result = await query("Test", sessionId);
    expect(result.meta.toolsCalled).toEqual([]);
  });
});
