/**
 * Main TUI application.
 *
 * Three-panel layout:
 *   Left:   Search history sidebar
 *   Right:  Profile results table / detail view (scrollable)
 *   Bottom: Status bar + search input
 *
 * Keyboard:
 *   Tab         - Cycle focus: input -> results -> sidebar
 *   j/k, Up/Dn - Navigate (sidebar selection, results scroll)
 *   Enter       - Submit search / select sidebar entry
 *   0-9         - Show detail for profile at that index (outside input)
 *   Esc         - Back to results from detail view / return to input
 *   q / Ctrl+C  - Quit (when input is not focused)
 *
 * Slash commands (typed in the input):
 *   /help, /h       - Show help
 *   /detail n, /d n - View profile at index n
 *   /clear          - Clear results and history
 *   /quit, /q       - Exit
 */
import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  type KeyEvent,
  TextRenderable,
  bold,
  createCliRenderer,
  fg,
  t,
} from "@opentui/core";

import {
  type AgentResult,
  type SearchResult,
  fetchRecentSessions,
  getDetail as rawGetDetail,
  query as rawQuery,
} from "../agent";
import { runInteractiveLogin } from "../auth/flows";
import { clearCredentials, getValidToken } from "../auth/store";
import { createResultsPanel } from "./results";
import {
  type SearchHistoryEntry,
  type SidebarState,
  createSidebar,
} from "./sidebar";
import { initTheme, theme } from "./theme";

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
  // ─── Detect Terminal Color Scheme ─────────────────────────────────────────

  initTheme();

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

  // ─── Load Recent Chat Sessions ─────────────────────────────────────────────

  const recentSessions = await fetchRecentSessions();
  const initialEntries: SearchHistoryEntry[] = recentSessions.map((s) => ({
    sessionId: s.sessionId,
    query: s.title,
    resultCount: 0,
    timestamp: s.updatedAt,
  }));

  // ─── Initialize TUI ─────────────────────────────────────────────────────

  // Clear the terminal so login output (or any prior text) doesn't bleed through
  process.stdout.write("\x1b[2J\x1b[H");

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
  });

  // ─── State ─────────────────────────────────────────────────────────────────

  type FocusTarget = "input" | "results" | "sidebar";
  let currentFocus: FocusTarget = "input";

  /** The session ID of the currently active chat (null = next query creates a new chat). */
  let activeSessionId: string | null = null;

  // ─── Search History Sidebar ────────────────────────────────────────────────

  const sidebarState: SidebarState = {
    entries: initialEntries,
    selectedIndex: 0,
  };

  const sidebar = createSidebar(renderer, sidebarState, {
    onSelect: async (entry: SearchHistoryEntry) => {
      activeSessionId = entry.sessionId;
      resultsPanel.update({ loading: true, loadingMessage: "Loading..." });
      const result = await query(entry.query, entry.sessionId);
      resultsPanel.update({ result, loading: false });
      setFocus("input");
    },
    onNewChat: () => {
      activeSessionId = null;
      resultsPanel.update({ result: null, loading: false });
      setFocus("input");
    },
  });

  // ─── Results Panel ─────────────────────────────────────────────────────────

  const resultsPanel = createResultsPanel(renderer);

  // ─── Search Input ──────────────────────────────────────────────────────────

  const searchInput = new InputRenderable(renderer, {
    id: "search-input",
    placeholder:
      'Search for talent... (e.g. "React devs in Lisbon") or type / for commands',
    width: "100%",
    textColor: theme.fg,
    cursorColor: theme.fg,
  });

  // ─── Status Bar ───────────────────────────────────────────────────────────

  const muted = fg(theme.fgMuted);

  const statusBar = new TextRenderable(renderer, {
    id: "status-bar",
    content: t`${muted("Type to search or / for commands")}`,
    paddingLeft: 1,
    paddingRight: 1,
  });

  function updateStatusBar(text: string): void {
    statusBar.content = t`${muted(text)}`;
  }

  function getStatusHint(): string {
    switch (currentFocus) {
      case "input":
        return "Type to search or / for commands    Tab: switch panel";
      case "results":
        return "j/k: scroll    0-9: detail    Esc: back    Tab: switch panel";
      case "sidebar":
        return "j/k: navigate    Enter: select    Tab: switch panel";
    }
  }

  // ─── Layout ────────────────────────────────────────────────────────────────

  // Title bar
  const titleBar = new BoxRenderable(renderer, {
    id: "title-bar",
    width: "100%",
    height: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingLeft: 1,
    paddingRight: 1,
  });
  titleBar.add(
    new TextRenderable(renderer, {
      id: "title-text",
      content: t`${bold(fg(theme.fg)("Talent Agent"))}`,
    }),
  );
  titleBar.add(
    new TextRenderable(renderer, {
      id: "title-hints",
      content: t`${muted("Tab switch   / commands   q quit")}`,
    }),
  );

  // Main content area: sidebar + results
  const content = new BoxRenderable(renderer, {
    id: "content",
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
    gap: 0,
  });
  content.add(sidebar.container);
  content.add(resultsPanel.container);

  // Input bar wrapper with border
  const inputBar = new BoxRenderable(renderer, {
    id: "input-bar",
    width: "100%",
    height: 3,
    borderStyle: "rounded",
    borderColor: theme.border,
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
    gap: 0,
  });
  root.add(titleBar);
  root.add(content);
  root.add(statusBar);
  root.add(inputBar);

  renderer.root.add(root);

  // ─── Focus Management ──────────────────────────────────────────────────────

  function setFocus(target: FocusTarget): void {
    currentFocus = target;

    // Reset all borders to unfocused
    sidebar.container.borderColor = theme.border;
    resultsPanel.container.borderColor = theme.border;
    inputBar.borderColor = theme.border;

    // Highlight the focused panel
    switch (target) {
      case "input":
        searchInput.focus();
        inputBar.borderColor = theme.borderFocus;
        break;
      case "results":
        searchInput.blur();
        resultsPanel.container.borderColor = theme.borderFocus;
        resultsPanel.scrollBox.focus();
        break;
      case "sidebar":
        searchInput.blur();
        sidebar.container.borderColor = theme.borderFocus;
        break;
    }

    updateStatusBar(getStatusHint());
  }

  // Start with input focused
  setFocus("input");

  // ─── Slash Commands ───────────────────────────────────────────────────────

  function handleSlashCommand(input: string): void {
    const parts = input.slice(1).trim().split(/\s+/);
    const cmd = parts[0]?.toLowerCase() ?? "";
    const args = parts.slice(1);

    switch (cmd) {
      case "help":
      case "h":
        resultsPanel.showHelp();
        break;

      case "detail":
      case "d": {
        const idx = parseInt(args[0] ?? "", 10);
        if (isNaN(idx)) {
          updateStatusBar("Usage: /detail <number>  e.g. /detail 3");
          return;
        }
        showDetail(idx);
        break;
      }

      case "clear":
        sidebarState.entries.length = 0;
        sidebarState.selectedIndex = 0;
        sidebar.update();
        resultsPanel.update({ result: null, loading: false });
        updateStatusBar("Cleared results and history");
        break;

      case "login":
        handleLogin();
        break;

      case "logout":
        clearCredentials();
        handleLogin();
        break;

      case "quit":
      case "q":
        process.exit(0);
        break;

      default:
        updateStatusBar(`Unknown command: /${cmd}  Type /help for commands`);
        break;
    }
  }

  async function handleLogin(): Promise<void> {
    // Suspend the TUI so the interactive login flow can use the terminal
    renderer.suspend();
    process.stdout.write("\x1b[2J\x1b[H"); // clear screen

    try {
      await runInteractiveLogin();
      process.stdout.write("\nLogin successful. Returning to TUI...\n");
    } catch (error) {
      process.stdout.write(
        `\nLogin failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }

    // Brief pause so the user can read the result
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Resume the TUI
    renderer.resume();
    updateStatusBar("Returned to TUI");
    setFocus("input");
  }

  // ─── Search Execution ──────────────────────────────────────────────────────

  async function executeSearch(queryText: string): Promise<void> {
    if (!queryText.trim()) return;

    resultsPanel.update({
      loading: true,
      loadingMessage: `Searching: "${queryText}"`,
    });

    try {
      // Continue the active chat if one is selected, otherwise create a new one
      const result = await query(queryText, activeSessionId ?? undefined);

      if (activeSessionId) {
        // Update existing sidebar entry with the latest query
        const existing = sidebarState.entries.find(
          (e) => e.sessionId === activeSessionId,
        );
        if (existing) {
          existing.query = queryText;
          existing.resultCount =
            result.type === "search" ? result.totalMatches : 1;
          existing.timestamp = new Date();
        }
      } else {
        // New chat -- add to search history
        const historyEntry: SearchHistoryEntry = {
          sessionId: result.session,
          query: queryText,
          resultCount: result.type === "search" ? result.totalMatches : 1,
          timestamp: new Date(),
        };
        sidebarState.entries.unshift(historyEntry);
        sidebarState.selectedIndex = 1; // 0 = New Chat, 1 = first history entry
        activeSessionId = result.session;
      }

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
    if (!profile) {
      updateStatusBar(
        `No profile at index ${profileIndex}. Range: 0-${currentResult.profiles.length - 1}`,
      );
      return;
    }

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

    // Handle slash commands
    if (value.startsWith("/")) {
      handleSlashCommand(value);
      return;
    }

    await executeSearch(value);
  });

  // Show command hints when typing "/"
  searchInput.on(InputRenderableEvents.INPUT, (value: string) => {
    if (value.startsWith("/")) {
      updateStatusBar("/help  /detail <n>  /clear  /login  /logout  /quit");
    } else if (currentFocus === "input") {
      updateStatusBar(getStatusHint());
    }
  });

  // ─── Global Keyboard Handler ───────────────────────────────────────────────

  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    // Quit (only when not typing in input)
    if (key.name === "q" && currentFocus !== "input") {
      process.exit(0);
    }

    // Tab: cycle focus (input -> results -> sidebar -> input)
    if (key.name === "tab") {
      const order: FocusTarget[] = ["input", "results", "sidebar"];
      const idx = order.indexOf(currentFocus);
      setFocus(order[(idx + 1) % order.length]!);
      return;
    }

    // Escape: go back to list / return to input
    if (key.name === "escape") {
      const state = resultsPanel.getState();
      if (state.result?.type === "detail") {
        // Go back to the search results (offset by 1; index 0 = New Chat)
        const lastSearch = sidebarState.entries[sidebarState.selectedIndex - 1];
        if (lastSearch) {
          resultsPanel.update({ loading: true });
          const result = await query(lastSearch.query, lastSearch.sessionId);
          resultsPanel.update({ result, loading: false });
        }
      }
      setFocus("input");
      return;
    }

    // Sidebar navigation (when sidebar is focused)
    if (currentFocus === "sidebar") {
      switch (key.name) {
        case "up":
        case "k":
          sidebar.moveUp();
          return;
        case "down":
        case "j":
          sidebar.moveDown();
          return;
        case "return":
          sidebar.select();
          return;
      }
    }

    // Results navigation (when results is focused)
    if (currentFocus === "results") {
      switch (key.name) {
        case "up":
        case "k":
          resultsPanel.scrollBox.scrollBy(-1);
          return;
        case "down":
        case "j":
          resultsPanel.scrollBox.scrollBy(1);
          return;
      }
    }

    // Number keys for quick detail access (when not typing in input)
    if (currentFocus !== "input") {
      const digit = parseInt(key.name, 10);
      if (!isNaN(digit)) {
        await showDetail(digit);
        return;
      }
    }
  });
}
