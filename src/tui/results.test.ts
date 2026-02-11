/**
 * Unit tests for the TUI results panel.
 *
 * Since the TUI uses @opentui/core Renderables, we mock the renderer
 * and verify the panel's state management and update logic.
 *
 * Uses vi.resetModules() + dynamic import to avoid stale module mocks
 * from other test files (e.g. app.test.ts). Mock assertions access
 * methods directly on returned instances (panel.container.add) rather
 * than shared module-level vi.fn() refs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DetailResult, SearchResult } from "../agent";
import { createResultsPanel } from "./results";

// Mock @opentui/core — each instance gets its own vi.fn() methods
vi.mock("@opentui/core", () => {
  class BoxRenderable {
    id: string;
    add = vi.fn();
    remove = vi.fn();
    getChildren = vi.fn(() => []);
    constructor(_renderer: any, opts: any) {
      this.id = opts.id;
    }
  }

  class ScrollBoxRenderable {
    id: string;
    add = vi.fn();
    remove = vi.fn();
    getChildren = vi.fn(() => []);
    scrollTo = vi.fn();
    scrollBy = vi.fn();
    focus = vi.fn();
    constructor(_renderer: any, opts: any) {
      this.id = opts.id;
    }
  }

  class TextRenderable {
    id: string;
    content: any;
    constructor(_renderer: any, opts: any) {
      this.id = opts.id;
      this.content = opts.content;
    }
  }

  return {
    BoxRenderable,
    ScrollBoxRenderable,
    TextRenderable,
    bold: (s: any) => s,
    dim: (s: any) => s,
    fg: (_color: string) => (s: any) => s,
    t: (strings: TemplateStringsArray, ...values: any[]) =>
      strings.reduce((result, str, i) => result + str + (values[i] || ""), ""),
  };
});

describe("createResultsPanel", () => {
  const mockRenderer = {} as any;
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns container, scrollBox, update, showHelp, and getState", () => {
    const panel = createResultsPanel(mockRenderer);

    expect(panel.container).toBeDefined();
    expect(panel.scrollBox).toBeDefined();
    expect(typeof panel.update).toBe("function");
    expect(typeof panel.showHelp).toBe("function");
    expect(typeof panel.getState).toBe("function");
  });

  it("has null result and false loading in initial state", () => {
    const panel = createResultsPanel(mockRenderer);
    const state = panel.getState();

    expect(state.result).toBeNull();
    expect(state.loading).toBe(false);
  });

  it("renders welcome screen when result is null", () => {
    const panel = createResultsPanel(mockRenderer);

    // Initial render adds the scrollBox to container, then content to scrollBox
    expect(panel.container.add).toHaveBeenCalled();
    expect(panel.scrollBox.add).toHaveBeenCalled();
  });

  it("updates state on update call", () => {
    const panel = createResultsPanel(mockRenderer);

    panel.update({ loading: true, loadingMessage: "Searching..." });
    const state = panel.getState();

    expect(state.loading).toBe(true);
    expect(state.loadingMessage).toBe("Searching...");
  });

  it("updates state with search result", () => {
    const panel = createResultsPanel(mockRenderer);

    const searchResult: SearchResult = {
      type: "search",
      session: "s1",
      query: "Find devs",
      profiles: [
        {
          id: "p1",
          displayName: "Jane Doe",
          mainRole: "Engineer",
          location: "Lisbon",
        },
      ],
      totalMatches: 1,
      summary: "Found 1.",
      appliedFilters: {},
    };

    panel.update({ result: searchResult, loading: false });
    const state = panel.getState();

    expect(state.result).toEqual(searchResult);
    expect(state.loading).toBe(false);
  });

  it("updates state with detail result", () => {
    const panel = createResultsPanel(mockRenderer);

    const detailResult: DetailResult = {
      type: "detail",
      session: "s1",
      profile: {
        id: "p1",
        displayName: "Jane Doe",
        mainRole: "Engineer",
      } as any,
      summary: "Details",
    };

    panel.update({ result: detailResult, loading: false });
    const state = panel.getState();

    expect(state.result?.type).toBe("detail");
  });

  it("updates state with error result", () => {
    const panel = createResultsPanel(mockRenderer);

    panel.update({
      result: {
        type: "error",
        session: "s1",
        error: "Something went wrong",
      },
      loading: false,
    });

    const state = panel.getState();
    expect(state.result?.type).toBe("error");
  });

  it("clears scrollBox content before each render", () => {
    const panel = createResultsPanel(mockRenderer);

    // scrollBox.remove is called to clear content on each update
    panel.update({ loading: true });

    expect(panel.scrollBox.remove).toHaveBeenCalled();
  });
});
