/**
 * Single-shot mode: run a query and print results to stdout, then exit.
 *
 * Usage:
 *   talent-agent "Find React developers in Lisbon"
 *   talent-agent --json "Find senior Python engineers"
 *   talent-agent --session abc123 "Only show seniors"
 *   talent-agent --session abc123 --detail 0
 */
import { getDetail, query } from "../agent";
import {
  EXIT_APP_ERROR,
  EXIT_SUCCESS,
  exitCodeForError,
  toAIFriendlyError,
} from "../errors";
import {
  formatDetailResult,
  formatError,
  formatSearchResult,
  toJSON,
} from "../format";

function wrapEnvelope(
  success: boolean,
  data: unknown,
  meta: { durationMs: number; tokensUsed: number; toolsCalled: string[] },
  error?: { message: string; code: string },
): string {
  if (success) {
    return JSON.stringify({ success: true, data, meta }, null, 2);
  }
  return JSON.stringify(
    { success: false, error: error!.message, code: error!.code },
    null,
    2,
  );
}

export async function runSingleShot(
  queryText: string,
  sessionId?: string,
  detailIndex?: number,
  jsonOutput: boolean = false,
  debug: boolean = false,
): Promise<void> {
  try {
    let response;

    if (detailIndex !== undefined && sessionId) {
      // Detail mode: get profile detail by index from previous search
      response = await getDetail(sessionId, detailIndex, { debug });
    } else {
      // Search mode
      response = await query(queryText, sessionId, { debug });
    }

    const { result, meta } = response;

    if (jsonOutput) {
      if (result.type === "error") {
        const friendly = toAIFriendlyError(result.error);
        console.log(wrapEnvelope(false, null, meta, friendly));
        process.exit(exitCodeForError(friendly.code));
      } else {
        console.log(wrapEnvelope(true, result, meta));
      }
    } else {
      switch (result.type) {
        case "search":
          console.log(formatSearchResult(result));
          break;
        case "detail":
          console.log(formatDetailResult(result));
          break;
        case "error":
          console.error(formatError(result.error, result.session));
          process.exit(EXIT_APP_ERROR);
      }
    }
  } catch (error) {
    const friendly = toAIFriendlyError(error);
    if (jsonOutput) {
      console.log(
        wrapEnvelope(
          false,
          null,
          { durationMs: 0, tokensUsed: 0, toolsCalled: [] },
          friendly,
        ),
      );
    } else {
      console.error(formatError(friendly.message));
    }
    process.exit(exitCodeForError(friendly.code));
  }
}
