/**
 * Main TUI application.
 *
 * Two-column layout:
 *   Left:   Search history sidebar
 *   Right:  Profile results table / detail view
 *   Bottom: Search input bar
 *
 * Keyboard:
 *   Tab         - Switch focus between sidebar and search input
 *   Up/Down     - Navigate sidebar entries (when sidebar focused)
 *   Enter       - Submit search / select sidebar entry
 *   d + digit   - Show detail for profile at that index
 *   Esc         - Back to results from detail view / unfocus sidebar
 *   q / Ctrl+C  - Quit
 */
import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  type KeyEvent,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  bold,
  createCliRenderer,
  dim,
  fg,
  t,
} from "@opentui/core";

import {
  type AgentResult,
  type SearchResult,
  getDetail as rawGetDetail,
  query as rawQuery,
} from "../agent";
import { runInteractiveLogin } from "../auth/flows";
import { getValidToken } from "../auth/store";
import { createResultsPanel } from "./results";
import {
  type SearchHistoryEntry,
  type SidebarState,
  createSidebar,
} from "./sidebar";

/** Unwrap the { result, meta } envelope from agent calls for TUI usage. */
async function query(input: string, sessionId?: string): Promise<AgentResult> {
  const { result } = await rawQuery(input, sessionId);
  return result;
}

async function getDetail(
  sessionId: string,
  profileIndex: number,
): Promise<AgentResult> {
  const { result } = await rawGetDetail(sessionId, profileIndex);
  return result;
}

export async function runTUI(): Promise<void> {
  // ─── Auth Check ──────────────────────────────────────────────────────────

  const token = await getValidToken();
  if (!token) {
    console.log("You are not authenticated.\n");
    try {
      await runInteractiveLogin();
    } catch (error) {
      console.error(
        `Login failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }

    // Verify auth succeeded
    const newToken = await getValidToken();
    if (!newToken) {
      console.error("Authentication required. Run 'talent-agent login' first.");
      process.exit(1);
    }
    console.log(""); // blank line before TUI
  }

  // ─── Initialize TUI ─────────────────────────────────────────────────────

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  // ─── State ─────────────────────────────────────────────────────────────────

  type FocusTarget = "input" | "sidebar";
  let currentFocus: FocusTarget = "input";
  let pendingDetail = false; // waiting for digit after 'd'

  // ─── Search History Sidebar ────────────────────────────────────────────────

  const sidebarState: SidebarState = {
    entries: [],
    selectedIndex: 0,
  };

  const sidebar = createSidebar(renderer, sidebarState, {
    onSelect: async (entry: SearchHistoryEntry) => {
      resultsPanel.update({ loading: true, loadingMessage: "Loading..." });
      const result = await query(entry.query, entry.sessionId);
      resultsPanel.update({ result, loading: false });
      setFocus("input");
    },
  });

  // ─── Results Panel ─────────────────────────────────────────────────────────

  const resultsPanel = createResultsPanel(renderer);

  // ─── Search Input ──────────────────────────────────────────────────────────

  const searchInput = new InputRenderable(renderer, {
    id: "search-input",
    placeholder:
      'Search for talent... (e.g. "Find React developers in Lisbon")',
    width: "100%",
    backgroundColor: "#1a1b26",
    focusedBackgroundColor: "#24283b",
    textColor: "#c0caf5",
    cursorColor: "#7aa2f7",
  });

  // ─── Layout ────────────────────────────────────────────────────────────────

  // Title bar
  const titleBar = new BoxRenderable(renderer, {
    id: "title-bar",
    width: "100%",
    height: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingLeft: 1,
    paddingRight: 1,
    backgroundColor: "#1a1b26",
  });
  titleBar.add(
    new TextRenderable(renderer, {
      id: "title-text",
      content: t`${bold(fg("#7dcfff")("Talent Search"))}`,
    }),
  );
  titleBar.add(
    new TextRenderable(renderer, {
      id: "title-hints",
      content: t`${dim("[Tab] switch  [q] quit")}`,
    }),
  );

  // Main content area: sidebar + results
  const content = new BoxRenderable(renderer, {
    id: "content",
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
  });
  content.add(sidebar.container);
  content.add(resultsPanel.container);

  // Input bar wrapper with border
  const inputBar = new BoxRenderable(renderer, {
    id: "input-bar",
    width: "100%",
    height: 3,
    borderStyle: "rounded",
    borderColor: "#7aa2f7",
    title: " Query ",
    titleAlignment: "left",
  });
  inputBar.add(searchInput);

  // Root layout
  const root = new BoxRenderable(renderer, {
    id: "root",
    width: "100%",
    height: "100%",
    flexDirection: "column",
  });
  root.add(titleBar);
  root.add(content);
  root.add(inputBar);

  renderer.root.add(root);

  // ─── Focus Management ──────────────────────────────────────────────────────

  function setFocus(target: FocusTarget): void {
    currentFocus = target;
    if (target === "input") {
      searchInput.focus();
      sidebar.container.borderColor = "#444444";
      inputBar.borderColor = "#7aa2f7";
    } else {
      searchInput.blur();
      sidebar.container.borderColor = "#7aa2f7";
      inputBar.borderColor = "#444444";
    }
  }

  // Start with input focused
  setFocus("input");

  // ─── Search Execution ──────────────────────────────────────────────────────

  async function executeSearch(queryText: string): Promise<void> {
    if (!queryText.trim()) return;

    resultsPanel.update({
      loading: true,
      loadingMessage: `Searching: "${queryText}"`,
    });

    try {
      const result = await query(queryText);

      // Add to search history
      const historyEntry: SearchHistoryEntry = {
        sessionId: result.session,
        query: queryText,
        resultCount: result.type === "search" ? result.totalMatches : 1,
        timestamp: new Date(),
      };
      sidebarState.entries.unshift(historyEntry);
      sidebarState.selectedIndex = 0;
      sidebar.update();

      resultsPanel.update({ result, loading: false });
    } catch (error) {
      resultsPanel.update({
        result: {
          type: "error",
          session: "",
          error: error instanceof Error ? error.message : String(error),
        },
        loading: false,
      });
    }
  }

  async function showDetail(profileIndex: number): Promise<void> {
    const currentResult = resultsPanel.getState().result;
    if (!currentResult || currentResult.type !== "search") return;

    const profile = currentResult.profiles[profileIndex];
    if (!profile) return;

    resultsPanel.update({
      loading: true,
      loadingMessage: "Loading profile details...",
    });

    try {
      const result = await getDetail(currentResult.session, profileIndex);
      resultsPanel.update({ result, loading: false });
    } catch (error) {
      resultsPanel.update({
        result: {
          type: "error",
          session: currentResult.session,
          error: error instanceof Error ? error.message : String(error),
        },
        loading: false,
      });
    }
  }

  // ─── Input Events ──────────────────────────────────────────────────────────

  searchInput.on(InputRenderableEvents.ENTER, async (value: string) => {
    if (!value.trim()) return;
    searchInput.value = "";
    await executeSearch(value);
  });

  // ─── Global Keyboard Handler ───────────────────────────────────────────────

  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    // Handle pending detail request (d + digit)
    if (pendingDetail) {
      pendingDetail = false;
      const digit = parseInt(key.name, 10);
      if (!isNaN(digit)) {
        await showDetail(digit);
        return;
      }
    }

    // Quit (only when not typing in input)
    if (key.name === "q" && currentFocus !== "input") {
      process.exit(0);
    }

    // Tab: switch focus
    if (key.name === "tab") {
      setFocus(currentFocus === "input" ? "sidebar" : "input");
      return;
    }

    // Escape: go back to list / unfocus sidebar
    if (key.name === "escape") {
      const state = resultsPanel.getState();
      if (state.result?.type === "detail") {
        // Go back to the search results
        const lastSearch = sidebarState.entries[sidebarState.selectedIndex];
        if (lastSearch) {
          resultsPanel.update({ loading: true });
          const result = await query(lastSearch.query, lastSearch.sessionId);
          resultsPanel.update({ result, loading: false });
        }
      }
      setFocus("input");
      return;
    }

    // Sidebar navigation (only when sidebar is focused)
    if (currentFocus === "sidebar") {
      switch (key.name) {
        case "up":
          sidebar.moveUp();
          return;
        case "down":
          sidebar.moveDown();
          return;
        case "return":
          sidebar.select();
          return;
      }
    }

    // Detail shortcut: 'd' triggers detail mode (waits for next digit)
    if (key.name === "d" && currentFocus !== "input") {
      pendingDetail = true;
      return;
    }
  });
}
