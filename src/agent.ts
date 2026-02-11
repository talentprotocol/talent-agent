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
  id: string;
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
 * The server returns Server-Sent Events (SSE) where each line is formatted as:
 *   data: {JSON_OBJECT}
 *
 * Event types we extract:
 * - text-delta: text content deltas
 * - tool-input-available: complete tool call with input
 * - tool-output-available: tool result with output
 * - error: error messages
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

        // SSE format: "data: {JSON}" or "data: [DONE]"
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6); // Strip "data: " prefix

        // End-of-stream sentinel
        if (payload === "[DONE]") continue;

        try {
          const event = JSON.parse(payload) as Record<string, unknown>;
          const eventType = event.type as string;

          switch (eventType) {
            case "text-delta": {
              const delta = event.delta as string;
              if (delta) result.textParts.push(delta);
              break;
            }
            case "tool-input-available": {
              // Complete tool call with parsed input
              const toolCallId = event.toolCallId as string;
              const toolName = event.toolName as string;
              const input = event.input;
              result.toolCalls.push({
                toolCallId,
                toolName,
                args: input,
              });
              toolCallIdToName.set(toolCallId, toolName);
              break;
            }
            case "tool-output-available": {
              // Tool result with output
              const toolCallId = event.toolCallId as string;
              const output = event.output;
              const toolName = toolCallIdToName.get(toolCallId) || "unknown";
              result.toolResults.push({
                toolCallId,
                toolName,
                result: output,
              });
              break;
            }
            case "error": {
              const errorMsg = event.message as string;
              if (errorMsg) result.error = errorMsg;
              break;
            }
            // Ignore: start, start-step, finish-step, finish,
            // text-start, text-end, tool-input-start, tool-input-delta
            default:
              break;
          }
        } catch {
          // Skip lines that can't be parsed as JSON
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        const payload = trimmed.slice(6);
        if (payload !== "[DONE]") {
          try {
            const event = JSON.parse(payload) as Record<string, unknown>;
            if (event.type === "text-delta") {
              const delta = event.delta as string;
              if (delta) result.textParts.push(delta);
            }
          } catch {
            // Ignore
          }
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
        error: "Not authenticated. Run 'talent-agent login' first.",
        code: "AUTH_ERROR",
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    };
  }

  // Build the user message in AI SDK UIMessage format
  const userMessage: UIMessage = {
    id: nanoid(),
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

    // Store assistant response in session history.
    // Only keep text parts — tool-call/tool-result parts are ephemeral and
    // the server rejects them on subsequent requests (requires "data-" prefix).
    session.messages.push({
      id: nanoid(),
      role: "assistant",
      parts: textResponse ? [{ type: "text", text: textResponse }] : [],
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
 *
 * Calls the talent-pro detail endpoint directly instead of going through
 * the LLM chat flow, avoiding unnecessary token usage and latency.
 */
export async function getDetail(
  sessionId: string,
  profileIndex: number,
  _options?: QueryOptions,
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

  const token = await getValidToken();
  if (!token) {
    return {
      result: {
        type: "error",
        session: sessionId,
        error: "Not authenticated. Run 'talent-agent login' first.",
        code: "AUTH_ERROR",
      },
      meta: { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
    };
  }

  const startTime = performance.now();

  try {
    const proUrl = getTalentProUrl();
    const response = await fetch(
      `${proUrl}/api/profile/${encodeURIComponent(profile.id)}/detail`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const durationMs = Math.round(performance.now() - startTime);

    if (!response.ok) {
      let errorMessage = `Detail API error: ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) errorMessage = body.error;
      } catch {
        // Use default error message
      }

      const errResult: ErrorResult = {
        type: "error",
        session: sessionId,
        error: errorMessage,
      };
      session.lastResult = errResult;
      return {
        result: errResult,
        meta: { durationMs, tokensUsed: 0, toolsCalled: [] },
      };
    }

    const body = (await response.json()) as { profile: DetailedProfile };

    const detailResult: DetailResult = {
      type: "detail",
      session: sessionId,
      profile: body.profile,
      summary: "",
    };
    session.lastResult = detailResult;

    return {
      result: detailResult,
      meta: {
        durationMs,
        tokensUsed: 0,
        toolsCalled: ["getProfileDetails"],
      },
    };
  } catch (error) {
    const durationMs = Math.round(performance.now() - startTime);
    const friendly = toAIFriendlyError(error);

    const errResult: ErrorResult = {
      type: "error",
      session: sessionId,
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

// ─── Recent Sessions (for TUI History) ──────────────────────────────────────

/** Shape of a session from the /api/ai-chat/sessions response. */
interface AiChatSessionSummary {
  id: number;
  title: string | null;
  updated_at: string;
}

/**
 * Fetch the user's recent AI chat sessions from talent-pro.
 *
 * Returns an array of lightweight session summaries suitable for populating
 * the TUI sidebar history. Returns an empty array on any failure.
 */
export async function fetchRecentSessions(
  count = 10,
): Promise<Array<{ sessionId: string; title: string; updatedAt: Date }>> {
  try {
    const token = await getValidToken();
    if (!token) return [];

    const proUrl = getTalentProUrl();
    const response = await fetch(
      `${proUrl}/api/ai-chat/sessions?page=1&per_page=${count}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) return [];

    const body = (await response.json()) as {
      sessions: AiChatSessionSummary[];
    };

    return (body.sessions ?? []).map((s) => ({
      sessionId: String(s.id),
      title: s.title ?? "Untitled chat",
      updatedAt: new Date(s.updated_at),
    }));
  } catch {
    return [];
  }
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
