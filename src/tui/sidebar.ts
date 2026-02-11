/**
 * Search history sidebar for the TUI.
 *
 * Displays a scrollable list of past searches with result counts.
 * Supports keyboard navigation (Up/Down/j/k/Enter) to revisit searches.
 */
import {
  BoxRenderable,
  type CliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
  bold,
  fg,
  t,
} from "@opentui/core";

import { theme } from "./theme";

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
  onNewChat: () => void;
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
    borderColor: theme.border,
    title: " History ",
    titleAlignment: "left",
  });

  // Scrollable area for history entries
  const scrollBox = new ScrollBoxRenderable(renderer, {
    id: "sidebar-scroll",
    width: "100%",
    flexGrow: 1,
  });
  container.add(scrollBox);

  // Track IDs added to scrollBox for safe cleanup
  const contentIds: string[] = [];

  function addContent(child: BoxRenderable | TextRenderable): void {
    scrollBox.add(child);
    contentIds.push(child.id);
  }

  function clearContent(): void {
    for (const id of contentIds) {
      scrollBox.remove(id);
    }
    contentIds.length = 0;
  }

  function render(): void {
    clearContent();

    // "New Chat" action row (always at index 0)
    const isNewChatSelected = state.selectedIndex === 0;
    const newChatRow = new BoxRenderable(renderer, {
      id: "sidebar-new-chat",
      width: "100%",
      flexDirection: "row",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: isNewChatSelected ? theme.bgSecondary : undefined,
    });
    newChatRow.add(
      new TextRenderable(renderer, {
        id: "sidebar-new-chat-marker",
        content: isNewChatSelected ? "▸ " : "  ",
        fg: theme.fgSecondary,
      }),
    );
    newChatRow.add(
      new TextRenderable(renderer, {
        id: "sidebar-new-chat-label",
        content: t`${isNewChatSelected ? bold(fg(theme.fg)("+ New Chat")) : fg(theme.fgSecondary)("+ New Chat")}`,
        flexGrow: 1,
      }),
    );
    addContent(newChatRow);

    // Separator between "New Chat" and history entries
    if (state.entries.length > 0) {
      addContent(
        new TextRenderable(renderer, {
          id: "sidebar-sep",
          content: t`${fg(theme.border)(" ─".repeat(12))}`,
        }),
      );
    }

    if (state.entries.length === 0) {
      addContent(
        new TextRenderable(renderer, {
          id: "sidebar-empty-1",
          content: t`${fg(theme.fgMuted)("  No searches yet")}`,
          marginTop: 1,
        }),
      );
      addContent(
        new TextRenderable(renderer, {
          id: "sidebar-empty-2",
          content: t`${fg(theme.fgMuted)("  Type a query below")}`,
        }),
      );
      return;
    }

    for (let i = 0; i < state.entries.length; i++) {
      const entry = state.entries[i]!;
      // Offset by 1 because index 0 is "New Chat"
      const isSelected = i + 1 === state.selectedIndex;
      const queryTrunc =
        entry.query.length > 20 ? entry.query.slice(0, 19) + "…" : entry.query;

      const row = new BoxRenderable(renderer, {
        id: `sidebar-entry-${i}`,
        width: "100%",
        flexDirection: "row",
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? theme.bgSecondary : undefined,
      });

      row.add(
        new TextRenderable(renderer, {
          id: `sidebar-marker-${i}`,
          content: isSelected ? "▸ " : "  ",
          fg: theme.fgSecondary,
        }),
      );

      row.add(
        new TextRenderable(renderer, {
          id: `sidebar-query-${i}`,
          content: t`${isSelected ? bold(fg(theme.fg)(queryTrunc)) : fg(theme.fgSecondary)(queryTrunc)}`,
          flexGrow: 1,
        }),
      );

      // Only show result count when available (not for API-loaded entries)
      if (entry.resultCount > 0) {
        row.add(
          new TextRenderable(renderer, {
            id: `sidebar-count-${i}`,
            content: t`${fg(theme.fgMuted)(`(${entry.resultCount})`)}`,
            marginLeft: 1,
          }),
        );
      }

      addContent(row);
    }

    // Scroll to keep selected item visible
    scrollBox.scrollTo(Math.max(0, state.selectedIndex - 2));
  }

  // Initial render
  render();

  return {
    container,
    scrollBox,
    update: () => render(),
    moveUp: () => {
      state.selectedIndex = Math.max(0, state.selectedIndex - 1);
      render();
    },
    moveDown: () => {
      // Max index = entries.length (0 = New Chat, 1..N = history entries)
      state.selectedIndex = Math.min(
        state.entries.length,
        state.selectedIndex + 1,
      );
      render();
    },
    select: () => {
      if (state.selectedIndex === 0) {
        callbacks.onNewChat();
        return;
      }
      // Offset by 1 for history entries
      const entry = state.entries[state.selectedIndex - 1];
      if (entry) callbacks.onSelect(entry);
    },
    getState: () => state,
  };
}
