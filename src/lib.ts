/**
 * Programmatic TypeScript/JavaScript API for talent-cli.
 *
 * Provides a clean class-based interface for searching talent profiles
 * without going through the CLI argument parser.
 *
 * Usage:
 *   import { TalentSearch } from "talent-cli";
 *   const ts = new TalentSearch();
 *   const result = await ts.search("Find React developers in Berlin");
 */
import {
  type AgentMeta,
  type AgentResult,
  type DetailResult,
  type ErrorResult,
  type ProfileSummary,
  type SearchResult,
  getDetail,
  query,
} from "./agent";

// Re-export types for consumers
export type {
  AgentResult,
  AgentMeta,
  SearchResult,
  DetailResult,
  ErrorResult,
  ProfileSummary,
};

export interface SearchOptions {
  session?: string;
  debug?: boolean;
}

export interface SearchResponse {
  result: SearchResult;
  meta: AgentMeta;
}

export interface DetailResponse {
  result: DetailResult;
  meta: AgentMeta;
}

export interface RefineResponse {
  result: SearchResult;
  meta: AgentMeta;
}

export class TalentSearch {
  /**
   * Run a talent search query.
   */
  async search(
    queryText: string,
    options?: SearchOptions,
  ): Promise<SearchResponse> {
    const { result, meta } = await query(queryText, options?.session, {
      debug: options?.debug,
    });

    if (result.type === "error") {
      throw new Error(result.error);
    }

    if (result.type !== "search") {
      throw new Error(`Unexpected result type: ${result.type}`);
    }

    return { result, meta };
  }

  /**
   * Get detailed profile information by index from a search session.
   */
  async detail(
    session: string,
    index: number,
    options?: { debug?: boolean },
  ): Promise<DetailResponse> {
    const { result, meta } = await getDetail(session, index, {
      debug: options?.debug,
    });

    if (result.type === "error") {
      throw new Error(result.error);
    }

    if (result.type !== "detail") {
      throw new Error(`Unexpected result type: ${result.type}`);
    }

    return { result, meta };
  }

  /**
   * Refine an existing search with an additional query.
   * This continues the conversation in the given session.
   */
  async refine(
    session: string,
    queryText: string,
    options?: { debug?: boolean },
  ): Promise<RefineResponse> {
    const { result, meta } = await query(queryText, session, {
      debug: options?.debug,
    });

    if (result.type === "error") {
      throw new Error(result.error);
    }

    if (result.type !== "search") {
      throw new Error(`Unexpected result type: ${result.type}`);
    }

    return { result, meta };
  }
}
