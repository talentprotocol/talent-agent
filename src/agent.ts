/**
 * Agent client for the Talent CLI.
 *
 * Instead of running the agent locally, this module calls talent-pro's
 * /api/chat endpoint over HTTP with a Bearer token and parses the
 * streamed AI SDK UI message response.
 *
 * Manages local conversation sessions (message history) and extracts
 * structured tool results (profile lists, detail views) from the response.
 */
import { nanoid } from "nanoid";
import { readFileSync, writeFileSync } from "node:fs";

import { getValidToken } from "./auth/store";
import { toAIFriendlyError } from "./errors";
import type { ErrorCode } from "./errors";

// ─── Types ──────────────────────────────────────────────────────────────────

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

/** Detailed profile (mirrors talent-pro's DetailedProfile type) */
export interface DetailedProfile {
  id: string;
  displayName: string | null;
  name: string | null;
  bio: string | null;
  imageUrl?: string | null;
  mainRole: string | null | undefined;
  location: string | null;
  humanCheckmark?: boolean;
  openTo?: string | null | undefined;
  tags: string[];

  github?: {
    topLanguages: string | null | undefined;
    topFrameworks: string | null | undefined;
    technologyTags?: string | null | undefined;
    expertiseLevel: string | null | undefined;
    developerArchetype?: string | null | undefined;
    totalContributions: number | null | undefined;
    isRecentlyActive: boolean | null | undefined;
    activitySummary?: {
      summary: string;
      focusAreas: string;
      consistencyScore?: number;
      generatedAt?: string;
    } | null;
  };

  workExperience?: Array<{
    title: string;
    company: string;
    description: string;
    durationMonths: number;
    startDate?: string;
    endDate?: string;
    isCurrent: boolean;
    location?: string;
  }>;

  education?: Array<{
    degree: string;
    fieldOfStudy: string;
    school: string;
    startYear: number;
    endYear: number;
    description?: string;
  }>;

  linkedin?: {
    currentTitle: string | null | undefined;
    currentCompany: string | null | undefined;
    jobTitles?: string | null | undefined;
    companies?: string | null | undefined;
    totalYearsExperience: number | null | undefined;
    hasCurrentJob?: boolean | null | undefined;
  };
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

// ─── Internal types ─────────────────────────────────────────────────────────

interface UIMessagePart {
  type: string;
  text?: string;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  state?: string;
  output?: unknown;
}

interface UIMessage {
  id?: string;
  role: "user" | "assistant" | "system";
  parts: UIMessagePart[];
}

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

interface Session {
  id: string;
  messages: UIMessage[];
  lastResult: AgentResult | null;
}

// ─── Session Store ──────────────────────────────────────────────────────────

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

// ─── Session Persistence ────────────────────────────────────────────────────

interface SerializedSession {
  id: string;
  messages: UIMessage[];
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

// ─── Remote API Client ──────────────────────────────────────────────────────

function getTalentProUrl(): string {
  const url = process.env.TALENT_PRO_URL;
  if (!url) throw new Error("TALENT_PRO_URL is not set");
  return url.replace(/\/$/, "");
}

/**
 * Parse the AI SDK UI message stream response.
 *
 * The createAgentUIStreamResponse produces a streaming response where each line
 * is formatted as TYPE_CODE:JSON_DATA. We parse these to extract:
 * - Text parts (type 0)
 * - Tool calls (type 9)
 * - Tool results (type a)
 * - Finish metadata (type d/e)
 */
interface ParsedStreamResult {
  textParts: string[];
  toolCalls: { toolCallId: string; toolName: string; args: unknown }[];
  toolResults: { toolCallId: string; toolName: string; result: unknown }[];
  error: string | null;
}

async function parseUIMessageStream(
  response: Response,
): Promise<ParsedStreamResult> {
  const result: ParsedStreamResult = {
    textParts: [],
    toolCalls: [],
    toolResults: [],
    error: null,
  };

  if (!response.body) {
    result.error = "Empty response body";
    return result;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // Map from toolCallId to toolName for matching tool results
  const toolCallIdToName = new Map<string, string>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // Keep the last incomplete line in the buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // AI SDK stream format: TYPE_CODE:JSON_DATA
        const colonIndex = trimmed.indexOf(":");
        if (colonIndex === -1) continue;

        const typeCode = trimmed.slice(0, colonIndex);
        const jsonData = trimmed.slice(colonIndex + 1);

        try {
          switch (typeCode) {
            case "0": {
              // Text delta
              const text = JSON.parse(jsonData) as string;
              if (text) result.textParts.push(text);
              break;
            }
            case "9": {
              // Tool call
              const toolCall = JSON.parse(jsonData) as {
                toolCallId: string;
                toolName: string;
                args: unknown;
              };
              result.toolCalls.push(toolCall);
              toolCallIdToName.set(toolCall.toolCallId, toolCall.toolName);
              break;
            }
            case "a": {
              // Tool result
              const toolResult = JSON.parse(jsonData) as {
                toolCallId: string;
                result: unknown;
              };
              const toolName =
                toolCallIdToName.get(toolResult.toolCallId) || "unknown";
              result.toolResults.push({
                toolCallId: toolResult.toolCallId,
                toolName,
                result: toolResult.result,
              });
              break;
            }
            case "3": {
              // Error
              const errorMsg = JSON.parse(jsonData) as string;
              result.error = errorMsg;
              break;
            }
            // Type codes d (finish_message), e (finish_step), f (usage) etc. are informational
            default:
              // Ignore other type codes
              break;
          }
        } catch {
          // Skip lines that can't be parsed
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex !== -1) {
        const typeCode = trimmed.slice(0, colonIndex);
        const jsonData = trimmed.slice(colonIndex + 1);
        try {
          if (typeCode === "0") {
            const text = JSON.parse(jsonData) as string;
            if (text) result.textParts.push(text);
          }
        } catch {
          // Ignore
        }
      }
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Call the talent-pro /api/chat endpoint with the given messages.
 */
async function callChatApi(
  messages: UIMessage[],
  token: string,
): Promise<ParsedStreamResult> {
  const proUrl = getTalentProUrl();

  const response = await fetch(`${proUrl}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    let errorMessage = `Chat API error: ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

  return parseUIMessageStream(response);
}

// ─── Result Builder ─────────────────────────────────────────────────────────

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

// ─── Main Query Function ────────────────────────────────────────────────────

export interface QueryOptions {
  debug?: boolean;
}

/**
 * Send a query to the talent agent via the talent-pro /api/chat endpoint.
 * Uses the session's conversation history for context (refinement).
 *
 * Returns both the result and metadata about the call.
 */
export async function query(
  input: string,
  sessionId?: string,
  options?: QueryOptions,
): Promise<{ result: AgentResult; meta: AgentMeta }> {
  const session = getOrCreateSession(sessionId);

  // Get auth token
  const token = await getValidToken();
  if (!token) {
    return {
      result: {
        type: "error",
        session: session.id,
        error: "Not authenticated. Run 'talent-cli login' first.",
        code: "AUTH_ERROR",
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    };
  }

  // Build the user message in AI SDK UIMessage format
  const userMessage: UIMessage = {
    role: "user",
    parts: [{ type: "text", text: input }],
  };
  session.messages.push(userMessage);

  const startTime = performance.now();

  try {
    const streamResult = await callChatApi(session.messages, token);
    const durationMs = Math.round(performance.now() - startTime);

    if (streamResult.error) {
      const errResult: ErrorResult = {
        type: "error",
        session: session.id,
        error: streamResult.error,
      };
      session.lastResult = errResult;
      return {
        result: errResult,
        meta: { durationMs, tokensUsed: 0, toolsCalled: [] },
      };
    }

    const textResponse = streamResult.textParts.join("");
    const toolNames = streamResult.toolCalls.map((tc) => tc.toolName);

    if (options?.debug) {
      for (const tc of streamResult.toolCalls) {
        process.stderr.write(`[debug] Agent calling: ${tc.toolName}\n`);
        process.stderr.write(
          `[debug] Tool input: ${JSON.stringify(tc.args)}\n`,
        );
      }
      process.stderr.write(
        `[debug] Agent total: ${(durationMs / 1000).toFixed(1)}s\n`,
      );
    }

    // Store assistant response in session history
    const assistantParts: UIMessagePart[] = [];
    if (textResponse) {
      assistantParts.push({ type: "text", text: textResponse });
    }
    for (const tc of streamResult.toolCalls) {
      assistantParts.push({
        type: "tool-call",
        toolCallId: tc.toolCallId,
        toolName: tc.toolName,
        args: tc.args as Record<string, unknown>,
      });
    }
    for (const tr of streamResult.toolResults) {
      assistantParts.push({
        type: "tool-result",
        toolCallId: tr.toolCallId,
        toolName: tr.toolName,
        state: "output-available",
        output: tr.result,
      });
    }
    session.messages.push({
      role: "assistant",
      parts: assistantParts,
    });

    // Build structured result from tool outputs
    const result = buildResult(
      session.id,
      input,
      textResponse,
      streamResult.toolResults.map((tr) => ({
        toolName: tr.toolName,
        result: tr.result,
      })),
    );
    session.lastResult = result;

    const meta: AgentMeta = {
      durationMs,
      tokensUsed: 0, // Not available from streaming response
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

/**
 * Extract tool results from a stream response (for MCP/lib usage).
 */
export function extractToolResults(
  streamResult: ParsedStreamResult,
): { toolName: string; result: unknown }[] {
  return streamResult.toolResults.map((tr) => ({
    toolName: tr.toolName,
    result: tr.result,
  }));
}
