/**
 * Unit tests for agent session management, query, and getDetail.
 *
 * Tests session CRUD, persistence (save/load), extractTextResponse,
 * extractToolNames, extractTokenUsage, and the main query/getDetail flows.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { talentAgent } from "../../talent-apps/apps/talent-pro/app/lib/agents/talent-agent";
import {
  buildResult,
  createSession,
  extractToolResults,
  getAllSessions,
  getDetail,
  getOrCreateSession,
  getSession,
  loadSession,
  query,
  saveSession,
} from "./agent";

// Mock the talent agent before importing
vi.mock(
  "../../talent-apps/apps/talent-pro/app/lib/agents/talent-agent",
  () => ({
    talentAgent: {
      generate: vi.fn(),
    },
  }),
);

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
    tmpDir = mkdtempSync(join(tmpdir(), "talent-cli-test-"));
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
      messages: [{ role: "user", content: "Find React devs" }],
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
    expect(session!.messages[0]!.content).toBe("Find React devs");
  });

  it("round-trips a session through save and load", () => {
    const id = createSession();
    const session = getSession(id)!;

    // Add some data to the session
    session.messages.push({ role: "user", content: "Test query" });
    session.messages.push({ role: "assistant", content: "Test response" });
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

  it("sends query to agent and returns structured result", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "searchProfiles",
              input: { query: "Find React devs" },
            },
          ],
        },
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "tc-1",
              output: {
                profiles: [{ id: "p1", displayName: "Jane Doe" }],
                totalMatches: 1,
                appliedFilters: {},
              },
            },
          ],
        },
        {
          content: [{ type: "text", text: "Found 1 developer." }],
        },
      ],
      usage: { totalTokens: 500 },
    } as any);

    const result = await query("Find React devs");

    expect(result.result.type).toBe("search");
    expect(result.meta.tokensUsed).toBe(500);
    expect(result.meta.toolsCalled).toContain("searchProfiles");
    expect(result.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("stores messages in session history", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [
        {
          content: [{ type: "text", text: "Response text" }],
        },
      ],
      usage: { totalTokens: 100 },
    } as any);

    const sessionId = createSession();
    await query("Test query", sessionId);

    const session = getSession(sessionId)!;
    expect(session.messages).toHaveLength(2); // user + assistant
    expect(session.messages[0]!.role).toBe("user");
    expect(session.messages[0]!.content).toBe("Test query");
    expect(session.messages[1]!.role).toBe("assistant");
  });

  it("returns error result when agent throws", async () => {
    vi.mocked(talentAgent.generate).mockRejectedValue(
      new Error("connect ECONNREFUSED 127.0.0.1:9200"),
    );

    const result = await query("Find devs");

    expect(result.result.type).toBe("error");
    if (result.result.type === "error") {
      expect(result.result.error).toContain("OpenSearch");
      expect(result.result.code).toBe("CONNECTION_ERROR");
    }
    expect(result.meta.tokensUsed).toBe(0);
  });

  it("creates a new session when none is provided", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [],
      usage: { totalTokens: 0 },
    } as any);

    const result = await query("Test");

    expect(result.result.session).toBeTruthy();
  });

  it("uses existing session when sessionId is provided", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [],
      usage: { totalTokens: 0 },
    } as any);

    const sessionId = createSession();
    const result = await query("Test", sessionId);

    expect(result.result.session).toBe(sessionId);
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
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "searchProfiles",
              input: {},
            },
          ],
        },
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "tc-1",
              output: {
                profiles: [{ id: "p1", displayName: "Jane" }],
                totalMatches: 1,
              },
            },
          ],
        },
      ],
      usage: { totalTokens: 100 },
    } as any);

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
    // Set up session with search results
    vi.mocked(talentAgent.generate).mockResolvedValueOnce({
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "searchProfiles",
              input: {},
            },
          ],
        },
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "tc-1",
              output: {
                profiles: [
                  { id: "p1", displayName: "Jane Doe", name: "Jane Doe" },
                ],
                totalMatches: 1,
              },
            },
          ],
        },
      ],
      usage: { totalTokens: 100 },
    } as any);

    const sessionId = createSession();
    await query("Find devs", sessionId);

    // Mock the detail response
    vi.mocked(talentAgent.generate).mockResolvedValueOnce({
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tc-2",
              toolName: "getProfileDetails",
              input: { profileId: "p1" },
            },
          ],
        },
        {
          content: [
            {
              type: "tool-result",
              toolCallId: "tc-2",
              output: {
                success: true,
                profile: {
                  id: "p1",
                  displayName: "Jane Doe",
                  mainRole: "Engineer",
                },
              },
            },
          ],
        },
      ],
      usage: { totalTokens: 200 },
    } as any);

    const result = await getDetail(sessionId, 0);

    expect(result.result.type).toBe("detail");
    // The agent should have been called with a message about Jane Doe
    expect(talentAgent.generate).toHaveBeenCalledTimes(2);
  });
});

describe("extractTextResponse (via query)", () => {
  it("extracts text content from response steps", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [
        {
          content: [
            { type: "text", text: "Found results: " },
            { type: "text", text: "1 developer matched." },
          ],
        },
      ],
      usage: { totalTokens: 50 },
    } as any);

    const sessionId = createSession();
    const result = await query("Test", sessionId);

    // The text should be extracted and stored in the session
    const session = getSession(sessionId)!;
    const assistantMsg = session.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toContain("Found results:");
    expect(assistantMsg?.content).toContain("1 developer matched.");
  });

  it("returns empty string when no text content in steps", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [
        {
          content: [
            {
              type: "tool-call",
              toolCallId: "tc-1",
              toolName: "searchProfiles",
              input: {},
            },
          ],
        },
      ],
      usage: { totalTokens: 50 },
    } as any);

    const sessionId = createSession();
    await query("Test", sessionId);

    const session = getSession(sessionId)!;
    const assistantMsg = session.messages.find((m) => m.role === "assistant");
    expect(assistantMsg?.content).toBe("");
  });
});

describe("extractTokenUsage (via query meta)", () => {
  it("extracts token usage from response", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [],
      usage: { totalTokens: 1234 },
    } as any);

    const result = await query("Test");
    expect(result.meta.tokensUsed).toBe(1234);
  });

  it("returns 0 when no usage info", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [],
    } as any);

    const result = await query("Test");
    expect(result.meta.tokensUsed).toBe(0);
  });
});

describe("extractToolNames (via query meta)", () => {
  it("extracts tool names from tool-call steps", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
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
      ],
      usage: { totalTokens: 100 },
    } as any);

    const result = await query("Test");
    expect(result.meta.toolsCalled).toEqual([
      "searchProfiles",
      "getProfileDetails",
    ]);
  });

  it("returns empty array when no tool calls", async () => {
    vi.mocked(talentAgent.generate).mockResolvedValue({
      steps: [
        {
          content: [{ type: "text", text: "Just text" }],
        },
      ],
      usage: { totalTokens: 50 },
    } as any);

    const result = await query("Test");
    expect(result.meta.toolsCalled).toEqual([]);
  });
});
