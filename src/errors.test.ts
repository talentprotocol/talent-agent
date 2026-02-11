/**
 * Unit tests for AI-friendly error rewriting and exit codes.
 */
import { describe, expect, it } from "vitest";

import {
  EXIT_APP_ERROR,
  EXIT_AUTH_ERROR,
  EXIT_SUCCESS,
  EXIT_TRANSIENT_ERROR,
  EXIT_USAGE_ERROR,
  type ErrorCode,
  exitCodeForError,
  toAIFriendlyError,
} from "./errors";

describe("exit code constants", () => {
  it("has correct values", () => {
    expect(EXIT_SUCCESS).toBe(0);
    expect(EXIT_APP_ERROR).toBe(1);
    expect(EXIT_USAGE_ERROR).toBe(2);
    expect(EXIT_AUTH_ERROR).toBe(3);
    expect(EXIT_TRANSIENT_ERROR).toBe(4);
  });
});

describe("toAIFriendlyError", () => {
  it("handles ECONNREFUSED errors", () => {
    const error = new Error("connect ECONNREFUSED 127.0.0.1:3000");
    const result = toAIFriendlyError(error);

    expect(result.code).toBe("CONNECTION_ERROR");
    expect(result.message).toContain("Cannot connect");
    expect(result.message).toContain("TALENT_PRO_URL");
  });

  it("handles 401 Unauthorized errors", () => {
    const result = toAIFriendlyError(
      new Error("Request failed with status 401"),
    );

    expect(result.code).toBe("AUTH_ERROR");
    expect(result.message).toContain("token");
    expect(result.message).toContain("login");
  });

  it("handles Unauthorized string in error", () => {
    const result = toAIFriendlyError(new Error("Unauthorized access"));

    expect(result.code).toBe("AUTH_ERROR");
    expect(result.message).toContain("token");
  });

  it("handles rate_limit errors", () => {
    const result = toAIFriendlyError(new Error("rate_limit exceeded"));

    expect(result.code).toBe("RATE_LIMIT");
    expect(result.message).toContain("Rate limit");
    expect(result.message).toContain("60s");
  });

  it("handles context_length_exceeded errors", () => {
    const result = toAIFriendlyError(
      new Error("context_length_exceeded: max 200000 tokens"),
    );

    expect(result.code).toBe("CONTEXT_OVERFLOW");
    expect(result.message).toContain("Session history too long");
    expect(result.message).toContain("new session");
  });

  it("handles ENOTFOUND errors", () => {
    const result = toAIFriendlyError(
      new Error("getaddrinfo ENOTFOUND api.example.com"),
    );

    expect(result.code).toBe("CONNECTION_ERROR");
    expect(result.message).toContain("Network error");
  });

  it("handles ETIMEDOUT errors", () => {
    const result = toAIFriendlyError(new Error("connect ETIMEDOUT"));

    expect(result.code).toBe("CONNECTION_ERROR");
    expect(result.message).toContain("Network error");
    expect(result.message).toContain("endpoint URLs");
  });

  it("handles ECONNRESET errors", () => {
    const result = toAIFriendlyError(new Error("read ECONNRESET"));

    expect(result.code).toBe("CONNECTION_ERROR");
    expect(result.message).toContain("Connection was reset");
    expect(result.message).toContain("Retry");
  });

  it("handles 403 Forbidden errors with subscription guidance", () => {
    const result = toAIFriendlyError(
      new Error("Request failed with status 403"),
    );

    expect(result.code).toBe("AUTH_ERROR");
    expect(result.message).toContain("Pro subscription required");
    expect(result.message).toContain("pro.talent.app/pricing");
    expect(result.message).toContain("billing status");
  });

  it("handles Pro organization required errors with subscription guidance", () => {
    const result = toAIFriendlyError(new Error("Pro organization required"));

    expect(result.code).toBe("AUTH_ERROR");
    expect(result.message).toContain("Pro subscription required");
    expect(result.message).toContain("pro.talent.app/pricing");
  });

  it("returns UNKNOWN_ERROR for unrecognized errors", () => {
    const result = toAIFriendlyError(
      new Error("Something unexpected happened"),
    );

    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("Something unexpected happened");
  });

  it("handles non-Error objects (strings)", () => {
    const result = toAIFriendlyError("plain string error");

    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("plain string error");
  });

  it("handles non-Error objects (numbers)", () => {
    const result = toAIFriendlyError(42);

    expect(result.code).toBe("UNKNOWN_ERROR");
    expect(result.message).toBe("42");
  });

  it("handles null/undefined errors", () => {
    expect(toAIFriendlyError(null).message).toBe("null");
    expect(toAIFriendlyError(undefined).message).toBe("undefined");
  });
});

describe("exitCodeForError", () => {
  it("maps AUTH_ERROR to EXIT_AUTH_ERROR", () => {
    expect(exitCodeForError("AUTH_ERROR")).toBe(EXIT_AUTH_ERROR);
  });

  it("maps RATE_LIMIT to EXIT_TRANSIENT_ERROR", () => {
    expect(exitCodeForError("RATE_LIMIT")).toBe(EXIT_TRANSIENT_ERROR);
  });

  it("maps CONNECTION_ERROR to EXIT_TRANSIENT_ERROR", () => {
    expect(exitCodeForError("CONNECTION_ERROR")).toBe(EXIT_TRANSIENT_ERROR);
  });

  it("maps VALIDATION_ERROR to EXIT_USAGE_ERROR", () => {
    expect(exitCodeForError("VALIDATION_ERROR")).toBe(EXIT_USAGE_ERROR);
  });

  it("maps CONTEXT_OVERFLOW to EXIT_APP_ERROR (default)", () => {
    expect(exitCodeForError("CONTEXT_OVERFLOW")).toBe(EXIT_APP_ERROR);
  });

  it("maps SESSION_NOT_FOUND to EXIT_APP_ERROR (default)", () => {
    expect(exitCodeForError("SESSION_NOT_FOUND")).toBe(EXIT_APP_ERROR);
  });

  it("maps INDEX_OUT_OF_RANGE to EXIT_APP_ERROR (default)", () => {
    expect(exitCodeForError("INDEX_OUT_OF_RANGE")).toBe(EXIT_APP_ERROR);
  });

  it("maps UNKNOWN_ERROR to EXIT_APP_ERROR (default)", () => {
    expect(exitCodeForError("UNKNOWN_ERROR")).toBe(EXIT_APP_ERROR);
  });
});
