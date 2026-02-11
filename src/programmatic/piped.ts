/**
 * Piped JSONL mode: read queries from stdin, write results to stdout.
 *
 * Input format (one JSON object per line):
 *   {"action": "search", "query": "Find React developers in Lisbon"}
 *   {"action": "search", "query": "Only show seniors", "session": "abc123"}
 *   {"action": "detail", "session": "abc123", "index": 0}
 *
 * Legacy format (backward compatible):
 *   {"query": "Find React developers in Lisbon"}
 *   {"query": "Only show seniors", "session": "abc123"}
 *   {"detail": 0, "session": "abc123"}
 *
 * Output format (one JSON envelope per line):
 *   {"success": true, "data": {...}, "meta": {...}, "id": "..."}
 *   {"success": false, "error": "...", "code": "...", "id": "..."}
 */
import { createInterface } from "node:readline";
import { z } from "zod";

import { getDetail, query } from "../agent";
import { toAIFriendlyError } from "../errors";

// ─── Zod-Validated Input Schema ──────────────────────────────────────────────

const searchInputSchema = z.object({
  action: z.literal("search"),
  id: z.string().optional(),
  query: z.string().min(1),
  session: z.string().optional(),
});

const detailInputSchema = z.object({
  action: z.literal("detail"),
  id: z.string().optional(),
  session: z.string(),
  index: z.number().nonnegative(),
});

const pipedInputSchema = z.discriminatedUnion("action", [
  searchInputSchema,
  detailInputSchema,
]);

type PipedInput = z.infer<typeof pipedInputSchema>;

// ─── Legacy Input ────────────────────────────────────────────────────────────

interface LegacyInput {
  query?: string;
  session?: string;
  detail?: number;
  id?: string;
}

function tryParseLegacy(raw: unknown): PipedInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const legacy = raw as LegacyInput;

  if (legacy.detail !== undefined && legacy.session) {
    return {
      action: "detail",
      session: legacy.session,
      index: legacy.detail,
      id: legacy.id,
    };
  }
  if (legacy.query) {
    return {
      action: "search",
      query: legacy.query,
      session: legacy.session,
      id: legacy.id,
    };
  }
  return null;
}

// ─── Output Helpers ──────────────────────────────────────────────────────────

function writeSuccess(
  data: unknown,
  meta: { durationMs: number; tokensUsed: number; toolsCalled: string[] },
  requestId?: string,
): void {
  const envelope: Record<string, unknown> = { success: true, data, meta };
  if (requestId) envelope.id = requestId;
  process.stdout.write(JSON.stringify(envelope) + "\n");
}

function writeError(message: string, code: string, requestId?: string): void {
  const envelope: Record<string, unknown> = {
    success: false,
    error: message,
    code,
  };
  if (requestId) envelope.id = requestId;
  process.stdout.write(JSON.stringify(envelope) + "\n");
}

// ─── Main ────────────────────────────────────────────────────────────────────

export async function runPiped(debug: boolean = false): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let requestId: string | undefined;

    try {
      const raw = JSON.parse(trimmed);

      // Try Zod-validated input first, then fall back to legacy format
      const zodResult = pipedInputSchema.safeParse(raw);
      let input: PipedInput;

      if (zodResult.success) {
        input = zodResult.data;
      } else {
        const legacy = tryParseLegacy(raw);
        if (legacy) {
          input = legacy;
        } else {
          writeError(
            'Invalid input: must provide "action" + "query" or "action" + "session" + "index". Legacy format: "query" or "detail" + "session".',
            "VALIDATION_ERROR",
            raw?.id,
          );
          continue;
        }
      }

      requestId = input.id;

      if (input.action === "detail") {
        const response = await getDetail(input.session, input.index, {
          debug,
        });
        writeSuccess(response.result, response.meta, requestId);
      } else {
        const response = await query(input.query, input.session, { debug });
        writeSuccess(response.result, response.meta, requestId);
      }
    } catch (error) {
      const friendly = toAIFriendlyError(error);
      writeError(friendly.message, friendly.code, requestId);
    }
  }
}
