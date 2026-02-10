/**
 * Unit tests for the MCP server tool definitions.
 *
 * Tests the tool registration and execution by mocking the agent
 * and verifying the MCP server responds correctly.
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

import { getDetail, query } from "../agent";

// Mock the agent module
vi.mock("../agent", () => ({
  query: vi.fn(),
  getDetail: vi.fn(),
}));

// Mock the MCP SDK with class constructors
const mockTool = vi.fn();
const mockConnect = vi.fn();

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class McpServer {
    tool = mockTool;
    connect = mockConnect;
    constructor(_opts: any) {}
  }
  return { McpServer };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  class StdioServerTransport {}
  return { StdioServerTransport };
});

describe("startMcpServer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    mock.restore();
  });

  it("registers three tools and connects transport", async () => {
    const { startMcpServer } = await import("./server");
    await startMcpServer();

    // Should register 3 tools: talent_search, talent_detail, talent_refine
    expect(mockTool).toHaveBeenCalledTimes(3);
    expect(mockConnect).toHaveBeenCalledTimes(1);

    // Check tool names
    const toolNames = mockTool.mock.calls.map((call: unknown[]) => call[0]);
    expect(toolNames).toContain("talent_search");
    expect(toolNames).toContain("talent_detail");
    expect(toolNames).toContain("talent_refine");
  });

  it("talent_search tool calls query and returns JSON content", async () => {
    const { startMcpServer } = await import("./server");
    await startMcpServer();

    // Find the talent_search handler
    const searchCall = mockTool.mock.calls.find(
      (call: unknown[]) => call[0] === "talent_search",
    );
    expect(searchCall).toBeDefined();

    const handler = searchCall![3]; // 4th argument is the handler

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

    const result = await handler({ query: "Find devs", session: undefined });

    expect(query).toHaveBeenCalledWith("Find devs", undefined);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("search");
    expect(parsed.meta.durationMs).toBe(100);
  });

  it("talent_search tool passes session ID", async () => {
    const { startMcpServer } = await import("./server");
    await startMcpServer();

    const searchCall = mockTool.mock.calls.find(
      (call: unknown[]) => call[0] === "talent_search",
    );
    const handler = searchCall![3];

    (query as any).mockResolvedValue({
      result: {
        type: "search",
        session: "my-session",
        query: "Find devs",
        profiles: [],
        totalMatches: 0,
        summary: "",
        appliedFilters: {},
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    });

    await handler({ query: "Find devs", session: "my-session" });

    expect(query).toHaveBeenCalledWith("Find devs", "my-session");
  });

  it("talent_detail tool calls getDetail and returns JSON content", async () => {
    const { startMcpServer } = await import("./server");
    await startMcpServer();

    const detailCall = mockTool.mock.calls.find(
      (call: unknown[]) => call[0] === "talent_detail",
    );
    expect(detailCall).toBeDefined();

    const handler = detailCall![3];

    (getDetail as any).mockResolvedValue({
      result: {
        type: "detail",
        session: "s1",
        profile: { id: "p1", displayName: "Jane Doe" } as any,
        summary: "Profile details",
      },
      meta: {
        durationMs: 200,
        tokensUsed: 800,
        toolsCalled: ["getProfileDetails"],
      },
    });

    const result = await handler({ session: "s1", index: 0 });

    expect(getDetail).toHaveBeenCalledWith("s1", 0);
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("detail");
    expect(parsed.profile.displayName).toBe("Jane Doe");
  });

  it("talent_refine tool calls query with session and returns results", async () => {
    const { startMcpServer } = await import("./server");
    await startMcpServer();

    const refineCall = mockTool.mock.calls.find(
      (call: unknown[]) => call[0] === "talent_refine",
    );
    expect(refineCall).toBeDefined();

    const handler = refineCall![3];

    (query as any).mockResolvedValue({
      result: {
        type: "search",
        session: "s1",
        query: "Only seniors",
        profiles: [],
        totalMatches: 5,
        summary: "Refined results",
        appliedFilters: {},
      },
      meta: {
        durationMs: 300,
        tokensUsed: 600,
        toolsCalled: ["searchProfiles"],
      },
    });

    const result = await handler({ session: "s1", query: "Only seniors" });

    expect(query).toHaveBeenCalledWith("Only seniors", "s1");
    expect(result.content).toHaveLength(1);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.type).toBe("search");
    expect(parsed.totalMatches).toBe(5);
  });

  it("tool descriptions are meaningful", async () => {
    const { startMcpServer } = await import("./server");
    await startMcpServer();

    for (const call of mockTool.mock.calls) {
      const [name, description] = call as [string, string];
      expect(description).toBeTruthy();
      expect(description.length).toBeGreaterThan(10);
    }
  });
});
