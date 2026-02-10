/**
 * Agent wrapper for the Talent CLI.
 *
 * Manages conversation sessions and extracts structured tool results
 * (profile lists, detail views) from the agent response steps.
 * The agent's text response is secondary metadata, not the primary output.
 */
import { nanoid } from "nanoid";
import { readFileSync, writeFileSync } from "node:fs";

import { talentAgent } from "../../talent-apps/apps/talent-pro/app/lib/agents/talent-agent";
import type { DetailedProfile } from "../../talent-apps/apps/talent-pro/app/lib/services/tools/get-profile-details";
import { toAIFriendlyError } from "./errors";
import type { ErrorCode } from "./errors";

// ─── Types ───────────────────────────────────────────────────────────────────

/** Profile summary returned from searchProfiles tool */
export interface ProfileSummary {
  id: string;
  displayName?: string;
  name?: string;
  bio?: string | null;
  mainRole?: string;
  location?: string;
  tags?: string[];
  githubTopLanguages?: string | string[];
  githubTopFrameworks?: string | string[];
  githubExpertiseLevel?: string;
  githubRecentlyActive?: boolean;
  linkedinCurrentTitle?: string;
  linkedinCurrentCompany?: string;
  linkedinYearsExperience?: number;
}

export interface SearchResult {
  type: "search";
  session: string;
  query: string;
  profiles: ProfileSummary[];
  totalMatches: number;
  summary: string;
  appliedFilters: Record<string, unknown>;
}

export interface DetailResult {
  type: "detail";
  session: string;
  profile: DetailedProfile;
  summary: string;
}

export interface ErrorResult {
  type: "error";
  session: string;
  error: string;
  code?: ErrorCode;
}

export type AgentResult = SearchResult | DetailResult | ErrorResult;

/** Metadata captured from agent responses for the success envelope. */
export interface AgentMeta {
  durationMs: number;
  tokensUsed: number;
  toolsCalled: string[];
}

// ─── Internal types for step parsing ─────────────────────────────────────────

interface ToolCallContent {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

interface ToolResultContent {
  type: "tool-result";
  toolCallId: string;
  output: unknown;
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  id: string;
  messages: ConversationMessage[];
  lastResult: AgentResult | null;
}

// ─── Session Store ───────────────────────────────────────────────────────────

const sessions = new Map<string, Session>();

export function createSession(): string {
  const id = nanoid(10);
  sessions.set(id, { id, messages: [], lastResult: null });
  return id;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

export function getOrCreateSession(id?: string): Session {
  if (id) {
    const existing = sessions.get(id);
    if (existing) return existing;
  }
  const newId = id ?? nanoid(10);
  const session: Session = { id: newId, messages: [], lastResult: null };
  sessions.set(newId, session);
  return session;
}

export function getAllSessions(): Session[] {
  return Array.from(sessions.values());
}

// ─── Session Persistence ─────────────────────────────────────────────────────

interface SerializedSession {
  id: string;
  messages: ConversationMessage[];
  lastResult: AgentResult | null;
}

export function saveSession(sessionId: string, filePath: string): void {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Session "${sessionId}" not found.`);
  }
  const data: SerializedSession = {
    id: session.id,
    messages: session.messages,
    lastResult: session.lastResult,
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function loadSession(filePath: string): string {
  const content = readFileSync(filePath, "utf-8");
  const data: SerializedSession = JSON.parse(content);
  const session: Session = {
    id: data.id,
    messages: data.messages,
    lastResult: data.lastResult,
  };
  sessions.set(session.id, session);
  return session.id;
}

// ─── Response Extraction ─────────────────────────────────────────────────────

type AgentResponse = Awaited<ReturnType<typeof talentAgent.generate>>;

function extractTextResponse(response: AgentResponse): string {
  const steps = (response as { steps?: Array<{ content?: unknown[] }> }).steps;
  if (!steps) return "";

  const textParts: string[] = [];
  for (const step of steps) {
    if (!step.content) continue;
    for (const content of step.content) {
      if (
        typeof content === "object" &&
        content !== null &&
        "type" in content &&
        content.type === "text" &&
        "text" in content
      ) {
        textParts.push(String((content as { text: string }).text));
      }
    }
  }
  return textParts.join("\n");
}

export function extractToolResults(
  response: AgentResponse,
): { toolName: string; result: unknown }[] {
  const results: { toolName: string; result: unknown }[] = [];
  const toolCallMap = new Map<string, string>();

  const steps = (response as { steps?: Array<{ content?: unknown[] }> }).steps;
  if (!steps) return results;

  for (const step of steps) {
    if (!step.content) continue;
    for (const content of step.content) {
      if (
        typeof content === "object" &&
        content !== null &&
        "type" in content &&
        content.type === "tool-call"
      ) {
        const toolCall = content as ToolCallContent;
        toolCallMap.set(toolCall.toolCallId, toolCall.toolName);
      }
    }
  }

  for (const step of steps) {
    if (!step.content) continue;
    for (const content of step.content) {
      if (
        typeof content === "object" &&
        content !== null &&
        "type" in content &&
        content.type === "tool-result"
      ) {
        const toolResult = content as ToolResultContent;
        const toolName = toolCallMap.get(toolResult.toolCallId) || "unknown";
        results.push({ toolName, result: toolResult.output });
      }
    }
  }

  return results;
}

/**
 * Extract all tool call names from the response (for metadata).
 */
function extractToolNames(response: AgentResponse): string[] {
  const names: string[] = [];
  const steps = (response as { steps?: Array<{ content?: unknown[] }> }).steps;
  if (!steps) return names;

  for (const step of steps) {
    if (!step.content) continue;
    for (const content of step.content) {
      if (
        typeof content === "object" &&
        content !== null &&
        "type" in content &&
        content.type === "tool-call"
      ) {
        names.push((content as ToolCallContent).toolName);
      }
    }
  }
  return names;
}

/**
 * Extract token usage from the response.
 */
function extractTokenUsage(response: AgentResponse): number {
  const resp = response as { usage?: { totalTokens?: number } };
  return resp.usage?.totalTokens ?? 0;
}

/**
 * Print debug information for a response to stderr.
 */
function printDebugInfo(response: AgentResponse, durationMs: number): void {
  const steps = (response as { steps?: Array<{ content?: unknown[] }> }).steps;
  if (!steps) return;

  for (const step of steps) {
    if (!step.content) continue;
    for (const content of step.content) {
      if (
        typeof content === "object" &&
        content !== null &&
        "type" in content &&
        content.type === "tool-call"
      ) {
        const tc = content as ToolCallContent;
        process.stderr.write(`[debug] Agent calling: ${tc.toolName}\n`);
        process.stderr.write(
          `[debug] Tool input: ${JSON.stringify(tc.input)}\n`,
        );
      }
    }
  }

  const tokens = extractTokenUsage(response);
  process.stderr.write(
    `[debug] Agent total: ${tokens.toLocaleString()} tokens, ${(durationMs / 1000).toFixed(1)}s\n`,
  );
}

// ─── Main Query Function ─────────────────────────────────────────────────────

export interface QueryOptions {
  debug?: boolean;
}

/**
 * Send a query to the talent agent and get structured results back.
 * Uses the session's conversation history for context (refinement).
 *
 * Returns both the result and metadata about the agent call.
 */
export async function query(
  input: string,
  sessionId?: string,
  options?: QueryOptions,
): Promise<{ result: AgentResult; meta: AgentMeta }> {
  const session = getOrCreateSession(sessionId);

  // Add user message to history
  session.messages.push({ role: "user", content: input });

  const startTime = performance.now();

  try {
    const response = await talentAgent.generate({
      options: {},
      messages: session.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    const durationMs = Math.round(performance.now() - startTime);

    if (options?.debug) {
      printDebugInfo(response, durationMs);
    }

    const textResponse = extractTextResponse(response);
    const toolResults = extractToolResults(response);
    const toolNames = extractToolNames(response);
    const tokensUsed = extractTokenUsage(response);

    // Store assistant response in history
    session.messages.push({ role: "assistant", content: textResponse });

    // Extract structured results from tool calls
    const result = buildResult(session.id, input, textResponse, toolResults);
    session.lastResult = result;

    const meta: AgentMeta = {
      durationMs,
      tokensUsed,
      toolsCalled: toolNames,
    };

    return { result, meta };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    const friendly = toAIFriendlyError(error);

    const errResult: ErrorResult = {
      type: "error",
      session: session.id,
      error: friendly.message,
      code: friendly.code,
    };
    session.lastResult = errResult;

    return {
      result: errResult,
      meta: { durationMs, tokensUsed: 0, toolsCalled: [] },
    };
  }
}

/**
 * Get detail for a profile by index from the last search result in a session.
 */
export async function getDetail(
  sessionId: string,
  profileIndex: number,
  options?: QueryOptions,
): Promise<{ result: AgentResult; meta: AgentMeta }> {
  const session = sessions.get(sessionId);
  if (!session?.lastResult || session.lastResult.type !== "search") {
    return {
      result: {
        type: "error",
        session: sessionId,
        error: "No search results in this session. Run a search first.",
        code: "SESSION_NOT_FOUND",
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    };
  }

  const profile = session.lastResult.profiles[profileIndex];
  if (!profile) {
    return {
      result: {
        type: "error",
        session: sessionId,
        error: `Profile index ${profileIndex} out of range. Last search had ${session.lastResult.profiles.length} results.`,
        code: "INDEX_OUT_OF_RANGE",
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    };
  }

  // Ask the agent to get profile details
  return query(
    `Show me the full profile details for ${profile.displayName || profile.name || profile.id} (ID: ${profile.id})`,
    sessionId,
    options,
  );
}

// ─── Result Builder ──────────────────────────────────────────────────────────

export function buildResult(
  sessionId: string,
  queryText: string,
  textResponse: string,
  toolResults: { toolName: string; result: unknown }[],
): AgentResult {
  // Check for getProfileDetails result first
  const detailsResult = toolResults.find(
    (r) => r.toolName === "getProfileDetails",
  );

  if (detailsResult) {
    const result = detailsResult.result as {
      success?: boolean;
      profile?: DetailedProfile;
    };

    if (result?.success && result?.profile) {
      return {
        type: "detail",
        session: sessionId,
        profile: result.profile,
        summary: textResponse,
      };
    }
  }

  // Check for searchProfiles result
  const searchResult = toolResults.find((r) => r.toolName === "searchProfiles");

  if (searchResult) {
    const result = searchResult.result as {
      profiles?: ProfileSummary[];
      totalMatches?: number;
      appliedFilters?: Record<string, unknown>;
    };

    return {
      type: "search",
      session: sessionId,
      query: queryText,
      profiles: result?.profiles ?? [],
      totalMatches: result?.totalMatches ?? 0,
      summary: textResponse,
      appliedFilters: result?.appliedFilters ?? {},
    };
  }

  // Check for searchInTable result
  const tableSearchResult = toolResults.find(
    (r) => r.toolName === "searchInTable",
  );

  if (tableSearchResult) {
    const result = tableSearchResult.result as {
      profiles?: ProfileSummary[];
      matchCount?: number;
    };

    return {
      type: "search",
      session: sessionId,
      query: queryText,
      profiles: result?.profiles ?? [],
      totalMatches: result?.matchCount ?? 0,
      summary: textResponse,
      appliedFilters: {},
    };
  }

  // No recognized tool results - return text-only as a search with 0 results
  return {
    type: "search",
    session: sessionId,
    query: queryText,
    profiles: [],
    totalMatches: 0,
    summary: textResponse || "No results found.",
    appliedFilters: {},
  };
}
