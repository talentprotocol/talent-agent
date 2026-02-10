/**
 * AI-friendly error rewriting and structured exit codes.
 *
 * Translates raw errors into actionable messages that AI agents
 * can understand and act upon programmatically.
 */

// ─── Exit Codes ──────────────────────────────────────────────────────────────

export const EXIT_SUCCESS = 0;
export const EXIT_APP_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_AUTH_ERROR = 3;
export const EXIT_TRANSIENT_ERROR = 4;

// ─── Error Codes ─────────────────────────────────────────────────────────────

export type ErrorCode =
  | "CONNECTION_ERROR"
  | "AUTH_ERROR"
  | "LOGIN_REQUIRED"
  | "RATE_LIMIT"
  | "CONTEXT_OVERFLOW"
  | "VALIDATION_ERROR"
  | "SESSION_NOT_FOUND"
  | "INDEX_OUT_OF_RANGE"
  | "UNKNOWN_ERROR";

// ─── AI-Friendly Error Rewriting ─────────────────────────────────────────────

export function toAIFriendlyError(error: unknown): {
  message: string;
  code: ErrorCode;
} {
  const msg = error instanceof Error ? error.message : String(error);

  if (msg.includes("ECONNREFUSED"))
    return {
      message:
        "Cannot connect to the server. Check TALENT_PRO_URL and TALENT_PROTOCOL_API_URL.",
      code: "CONNECTION_ERROR",
    };
  if (
    msg.includes("Authentication required") ||
    msg.includes("Not authenticated")
  )
    return {
      message: "Not authenticated. Run 'talent-agent login' first.",
      code: "AUTH_ERROR",
    };
  if (msg.includes("401") || msg.includes("Unauthorized"))
    return {
      message:
        "Auth token is invalid or expired. Run 'talent-agent login' to re-authenticate.",
      code: "AUTH_ERROR",
    };
  if (msg.includes("403") || msg.includes("Pro organization required"))
    return {
      message: "Pro organization required. Your account may not have access.",
      code: "AUTH_ERROR",
    };
  if (msg.includes("rate_limit"))
    return {
      message:
        "Rate limit hit. Wait 60s and retry, or use a different API key.",
      code: "RATE_LIMIT",
    };
  if (msg.includes("context_length_exceeded"))
    return {
      message: "Session history too long. Start a new session.",
      code: "CONTEXT_OVERFLOW",
    };
  if (msg.includes("ENOTFOUND") || msg.includes("ETIMEDOUT"))
    return {
      message:
        "Network error. Check your internet connection and endpoint URLs.",
      code: "CONNECTION_ERROR",
    };
  if (msg.includes("ECONNRESET"))
    return {
      message: "Connection was reset. Retry the request.",
      code: "CONNECTION_ERROR",
    };

  return { message: msg, code: "UNKNOWN_ERROR" };
}

/**
 * Map an error code to the appropriate process exit code.
 */
export function exitCodeForError(code: ErrorCode): number {
  switch (code) {
    case "AUTH_ERROR":
    case "LOGIN_REQUIRED":
      return EXIT_AUTH_ERROR;
    case "RATE_LIMIT":
    case "CONNECTION_ERROR":
      return EXIT_TRANSIENT_ERROR;
    case "VALIDATION_ERROR":
      return EXIT_USAGE_ERROR;
    default:
      return EXIT_APP_ERROR;
  }
}
