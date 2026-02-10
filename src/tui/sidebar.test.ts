/**
 * Unit tests for the TUI sidebar.
 *
 * Tests the sidebar's state management, navigation, and selection logic
 * by mocking the @opentui/core renderer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SidebarState } from "./sidebar";
import { createSidebar } from "./sidebar";

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
    borderColor: string;
    constructor(_renderer: any, opts: any) {
      this.id = opts.id;
      this.borderColor = opts.borderColor ?? "";
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

describe("createSidebar", () => {
  const mockRenderer = {} as any;
  let state: SidebarState;
  let onSelectMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChildren.mockReturnValue([]);
    onSelectMock = vi.fn();
    state = {
      entries: [],
      selectedIndex: 0,
    };
  });

  it("returns container and control methods", () => {
    const sidebar = createSidebar(mockRenderer, state, {
      onSelect: onSelectMock,
    });

    expect(sidebar.container).toBeDefined();
    expect(typeof sidebar.update).toBe("function");
    expect(typeof sidebar.moveUp).toBe("function");
    expect(typeof sidebar.moveDown).toBe("function");
    expect(typeof sidebar.select).toBe("function");
    expect(typeof sidebar.getState).toBe("function");
  });

  it("renders empty state message when no entries", () => {
    createSidebar(mockRenderer, state, { onSelect: onSelectMock });

    // Should have rendered empty state text
    expect(mockAdd).toHaveBeenCalled();
  });

  it("returns state reference", () => {
    const sidebar = createSidebar(mockRenderer, state, {
      onSelect: onSelectMock,
    });

    expect(sidebar.getState()).toBe(state);
  });

  describe("navigation", () => {
    it("moveDown increments selectedIndex", () => {
      state.entries = [
        {
          sessionId: "s1",
          query: "Query 1",
          resultCount: 5,
          timestamp: new Date(),
        },
        {
          sessionId: "s2",
          query: "Query 2",
          resultCount: 3,
          timestamp: new Date(),
        },
        {
          sessionId: "s3",
          query: "Query 3",
          resultCount: 1,
          timestamp: new Date(),
        },
      ];
      state.selectedIndex = 0;

      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.moveDown();
      expect(state.selectedIndex).toBe(1);

      sidebar.moveDown();
      expect(state.selectedIndex).toBe(2);
    });

    it("moveDown does not exceed last entry", () => {
      state.entries = [
        {
          sessionId: "s1",
          query: "Query 1",
          resultCount: 5,
          timestamp: new Date(),
        },
        {
          sessionId: "s2",
          query: "Query 2",
          resultCount: 3,
          timestamp: new Date(),
        },
      ];
      state.selectedIndex = 1;

      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.moveDown();
      expect(state.selectedIndex).toBe(1); // stays at last
    });

    it("moveUp decrements selectedIndex", () => {
      state.entries = [
        {
          sessionId: "s1",
          query: "Query 1",
          resultCount: 5,
          timestamp: new Date(),
        },
        {
          sessionId: "s2",
          query: "Query 2",
          resultCount: 3,
          timestamp: new Date(),
        },
      ];
      state.selectedIndex = 1;

      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.moveUp();
      expect(state.selectedIndex).toBe(0);
    });

    it("moveUp does not go below 0", () => {
      state.entries = [
        {
          sessionId: "s1",
          query: "Query 1",
          resultCount: 5,
          timestamp: new Date(),
        },
      ];
      state.selectedIndex = 0;

      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.moveUp();
      expect(state.selectedIndex).toBe(0);
    });

    it("moveDown is no-op when entries is empty", () => {
      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.moveDown();
      expect(state.selectedIndex).toBe(0);
    });

    it("moveUp is no-op when entries is empty", () => {
      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.moveUp();
      expect(state.selectedIndex).toBe(0);
    });
  });

  describe("select", () => {
    it("calls onSelect with the selected entry", () => {
      const entry = {
        sessionId: "s1",
        query: "Find React devs",
        resultCount: 10,
        timestamp: new Date(),
      };
      state.entries = [entry];
      state.selectedIndex = 0;

      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.select();

      expect(onSelectMock).toHaveBeenCalledWith(entry);
    });

    it("calls onSelect with correct entry when selectedIndex > 0", () => {
      const entry1 = {
        sessionId: "s1",
        query: "Query 1",
        resultCount: 5,
        timestamp: new Date(),
      };
      const entry2 = {
        sessionId: "s2",
        query: "Query 2",
        resultCount: 3,
        timestamp: new Date(),
      };
      state.entries = [entry1, entry2];
      state.selectedIndex = 1;

      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.select();

      expect(onSelectMock).toHaveBeenCalledWith(entry2);
    });

    it("does not call onSelect when entries is empty", () => {
      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      sidebar.select();

      expect(onSelectMock).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("re-renders when update is called", () => {
      const sidebar = createSidebar(mockRenderer, state, {
        onSelect: onSelectMock,
      });

      // Clear mock calls from initial render
      mockAdd.mockClear();
      mockRemove.mockClear();

      // Add an entry and update
      state.entries.push({
        sessionId: "s1",
        query: "New query",
        resultCount: 5,
        timestamp: new Date(),
      });

      sidebar.update();

      // Should have re-rendered (add was called again)
      expect(mockAdd).toHaveBeenCalled();
    });
  });
});
