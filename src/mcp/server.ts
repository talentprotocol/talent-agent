/**
 * MCP (Model Context Protocol) server for talent-agent.
 *
 * Exposes talent-agent as an MCP server over stdio transport, making it
 * natively usable by Claude, Cursor, Gemini CLI, GitHub Copilot, etc.
 *
 * Tools:
 *   - talent_search: Search for talent profiles
 *   - talent_detail: Get detailed profile information
 *   - talent_refine: Refine an existing search
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { getDetail, query } from "../agent";

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "talent-agent",
    version: "1.0.0",
  });

  // ─── talent_search ─────────────────────────────────────────────────────────

  server.tool(
    "talent_search",
    "Search for talent profiles using natural language. Returns a list of matching profiles with summaries.",
    {
      query: z
        .string()
        .describe(
          "Natural language search query, e.g. 'Find React developers in Berlin'",
        ),
      session: z
        .string()
        .optional()
        .describe("Session ID to continue a previous search conversation"),
    },
    async ({ query: queryText, session }) => {
      const { result, meta } = await query(queryText, session);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ...result, meta }, null, 2),
          },
        ],
      };
    },
  );

  // ─── talent_detail ─────────────────────────────────────────────────────────

  server.tool(
    "talent_detail",
    "Get detailed profile information for a candidate at a given index from the last search in a session.",
    {
      session: z.string().describe("Session ID from a previous search"),
      index: z
        .number()
        .nonnegative()
        .describe("Zero-based index of the profile in the last search results"),
    },
    async ({ session, index }) => {
      const { result, meta } = await getDetail(session, index);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ...result, meta }, null, 2),
          },
        ],
      };
    },
  );

  // ─── talent_refine ─────────────────────────────────────────────────────────

  server.tool(
    "talent_refine",
    "Refine an existing search with additional criteria. Continues the conversation in the given session.",
    {
      session: z
        .string()
        .describe("Session ID from a previous search to refine"),
      query: z
        .string()
        .describe(
          "Additional criteria or refinement query, e.g. 'Only show seniors' or 'Filter by Berlin location'",
        ),
    },
    async ({ session, query: queryText }) => {
      const { result, meta } = await query(queryText, session);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ...result, meta }, null, 2),
          },
        ],
      };
    },
  );

  // ─── Start Server ──────────────────────────────────────────────────────────

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
