/**
 * Search history sidebar for the TUI.
 *
 * Displays a list of past searches with result counts.
 * Supports keyboard navigation (Up/Down/Enter) to revisit previous searches.
 */
import {
  BoxRenderable,
  type CliRenderer,
  TextRenderable,
  bold,
  dim,
  fg,
  t,
} from "@opentui/core";

export interface SearchHistoryEntry {
  sessionId: string;
  query: string;
  resultCount: number;
  timestamp: Date;
}

export interface SidebarState {
  entries: SearchHistoryEntry[];
  selectedIndex: number;
}

export interface SidebarCallbacks {
  onSelect: (entry: SearchHistoryEntry) => void;
}

/**
 * Create the sidebar using Renderables for dynamic updates.
 * Returns the container and control methods.
 */
export function createSidebar(
  renderer: CliRenderer,
  state: SidebarState,
  callbacks: SidebarCallbacks,
) {
  const container = new BoxRenderable(renderer, {
    id: "sidebar",
    width: 28,
    flexShrink: 0,
    flexDirection: "column",
    borderStyle: "rounded",
    borderColor: "#444444",
    title: " History ",
    titleAlignment: "left",
  });

  function render(): void {
    // Remove all existing children
    for (const child of container.getChildren()) {
      container.remove(child.id);
    }

    if (state.entries.length === 0) {
      container.add(
        new TextRenderable(renderer, {
          id: "sidebar-empty-1",
          content: t`${dim("  No searches yet")}`,
          marginTop: 1,
        }),
      );
      container.add(
        new TextRenderable(renderer, {
          id: "sidebar-empty-2",
          content: t`${dim("  Type a query below")}`,
        }),
      );
      return;
    }

    for (let i = 0; i < state.entries.length; i++) {
      const entry = state.entries[i]!;
      const isSelected = i === state.selectedIndex;
      const queryTrunc =
        entry.query.length > 20 ? entry.query.slice(0, 19) + "…" : entry.query;

      const row = new BoxRenderable(renderer, {
        id: `sidebar-entry-${i}`,
        width: "100%",
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? "#2a3a5a" : undefined,
      });

      row.add(
        new TextRenderable(renderer, {
          id: `sidebar-marker-${i}`,
          content: isSelected ? "▸ " : "  ",
          fg: "#7aa2f7",
        }),
      );

      row.add(
        new TextRenderable(renderer, {
          id: `sidebar-query-${i}`,
          content: t`${isSelected ? bold(fg("#c0caf5")(queryTrunc)) : fg("#a9b1d6")(queryTrunc)}`,
          flexGrow: 1,
        }),
      );

      row.add(
        new TextRenderable(renderer, {
          id: `sidebar-count-${i}`,
          content: t`${dim(`(${entry.resultCount})`)}`,
          marginLeft: 1,
        }),
      );

      container.add(row);
    }
  }

  // Initial render
  render();

  return {
    container,
    update: () => render(),
    moveUp: () => {
      if (state.entries.length === 0) return;
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      render();
    },
    moveDown: () => {
      if (state.entries.length === 0) return;
      state.selectedIndex = Math.min(
        state.entries.length - 1,
        state.selectedIndex + 1,
      );
      render();
    },
    select: () => {
      const entry = state.entries[state.selectedIndex];
      if (entry) callbacks.onSelect(entry);
    },
    getState: () => state,
  };
}
