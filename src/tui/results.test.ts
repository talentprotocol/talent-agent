/**
 * Unit tests for the TUI results panel.
 *
 * Since the TUI uses @opentui/core Renderables, we mock the renderer
 * and verify the panel's state management and update logic.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DetailResult, SearchResult } from "../agent";
import { createResultsPanel } from "./results";

// Mock @opentui/core with proper class constructors
const mockAdd = vi.fn();
const mockRemove = vi.fn();
const mockGetChildren = vi.fn(() => []);

vi.mock("@opentui/core", () => {
  class BoxRenderable {
    id: string;
    add = mockAdd;
    remove = mockRemove;
    getChildren = mockGetChildren;
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
    mockGetChildren.mockReturnValue([]);
  });

  it("returns container, update, and getState", () => {
    const panel = createResultsPanel(mockRenderer);

    expect(panel.container).toBeDefined();
    expect(typeof panel.update).toBe("function");
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

    // Initial render already happens in createResultsPanel
    // The welcome screen should have been rendered via container.add
    expect(mockAdd).toHaveBeenCalled();
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
          location: "Berlin",
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

  it("clears children before each render", () => {
    // Setup: return mock children for removal
    const child1 = { id: "child-1" };
    const child2 = { id: "child-2" };
    mockGetChildren.mockReturnValue([child1, child2]);

    const panel = createResultsPanel(mockRenderer);

    // Update triggers re-render which should clear children first
    panel.update({ loading: true });

    // mockRemove should have been called to clear existing children
    expect(mockRemove).toHaveBeenCalled();
  });
});
