/**
 * Results panel for the TUI.
 *
 * Renders profile search results in a scrollable table, or a detailed
 * profile card when in detail view. Uses ScrollBox for content scrolling.
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

import type {
  AgentResult,
  DetailResult,
  ProfileSummary,
  SearchResult,
} from "../agent";
import { theme } from "./theme";

// ─── Colors ─────────────────────────────────────────────────────────────────

/** Resolve semantic color map from the active theme (must be called after initTheme). */
function resolveColors() {
  return {
    name: theme.success, // profile names
    role: theme.fg, // role / title text
    location: theme.blue, // location labels
    lang: theme.violet, // languages & tags
    dim: theme.fgMuted, // muted / secondary info
    accent: theme.blue, // section headers & accents
    warn: theme.warning, // index numbers
    header: theme.fg, // table column headers
    error: theme.destructive, // error messages
    linkedin: theme.linkedin, // LinkedIn brand blue
  } as const;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(
  str: string | string[] | null | undefined,
  maxLen: number,
): string {
  if (!str) return "";
  const s = Array.isArray(str) ? str.join(", ") : str;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

function wordWrap(text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length + word.length + 1 > maxWidth && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current += (current.length > 0 ? " " : "") + word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── Results State ───────────────────────────────────────────────────────────

export interface ResultsState {
  result: AgentResult | null;
  loading: boolean;
  loadingMessage?: string;
}

/**
 * Create the results panel.
 * Uses a ScrollBox inside a bordered container for scrollable content.
 */
export function createResultsPanel(renderer: CliRenderer) {
  // Resolve colors from the active theme (already initialized by initTheme)
  const COL = resolveColors();

  const state: ResultsState = { result: null, loading: false };
  let idCounter = 0;

  // Generate unique IDs for renderables (avoids conflicts on re-render)
  function uid(prefix: string): string {
    return `${prefix}-${idCounter++}`;
  }

  const container = new BoxRenderable(renderer, {
    id: "results",
    flexGrow: 1,
    flexDirection: "column",
    borderStyle: "rounded",
    borderColor: theme.border,
    title: " Results ",
    titleAlignment: "left",
    overflow: "hidden",
  });

  // Scrollable content area
  const scrollBox = new ScrollBoxRenderable(renderer, {
    id: "results-scroll",
    width: "100%",
    flexGrow: 1,
    viewportCulling: true,
    scrollbarOptions: {
      trackOptions: {
        foregroundColor: theme.fgMuted,
        backgroundColor: theme.bgCard,
      },
    },
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
    scrollBox.scrollTo(0);
  }

  function render(): void {
    clearContent();

    if (state.loading) {
      renderLoading();
      return;
    }

    if (!state.result) {
      renderWelcome();
      return;
    }

    switch (state.result.type) {
      case "search":
        renderSearchResults(state.result);
        break;
      case "detail":
        renderDetailView(state.result);
        break;
      case "error":
        renderError(state.result.error);
        break;
    }
  }

  function renderLoading(): void {
    const box = new BoxRenderable(renderer, {
      id: uid("loading"),
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
    });
    box.add(
      new TextRenderable(renderer, {
        id: uid("loading-text"),
        content: t`${fg(COL.accent)("⟳")} ${state.loadingMessage || "Searching..."}`,
      }),
    );
    addContent(box);
  }

  function renderWelcome(): void {
    const box = new BoxRenderable(renderer, {
      id: uid("welcome"),
      flexGrow: 1,
      justifyContent: "center",
      alignItems: "center",
      flexDirection: "column",
      gap: 1,
    });

    // ASCII logo (Talent double-L mark)
    const logoBox = new BoxRenderable(renderer, {
      id: uid("w-logo"),
      flexDirection: "column",
      alignItems: "center",
    });
    const logoLines = [
      " ██        ",
      " ██▄▄▄▄▄▄▄ ",
      " ██        ",
      " ██▄▄▄▄▄▄▄ ",
    ];
    for (const line of logoLines) {
      logoBox.add(
        new TextRenderable(renderer, {
          id: uid("w-ll"),
          content: t`${fg(theme.blue)(line)}`,
        }),
      );
    }
    box.add(logoBox);

    // Title + subtitle
    box.add(
      new TextRenderable(renderer, {
        id: uid("w-title"),
        content: t`${bold(fg(theme.fg)("TALENT AGENT"))}`,
      }),
    );
    box.add(
      new TextRenderable(renderer, {
        id: uid("w-subtitle"),
        content: t`${fg(COL.dim)("Search for talent profiles using natural language")}`,
      }),
    );

    // Examples section
    const examples = new BoxRenderable(renderer, {
      id: uid("w-examples"),
      flexDirection: "column",
      marginTop: 1,
    });
    examples.add(
      new TextRenderable(renderer, {
        id: uid("w-ex-label"),
        content: t`${fg(theme.fgSecondary)("Examples:")}`,
      }),
    );
    examples.add(
      new TextRenderable(renderer, {
        id: uid("w-ex-1"),
        content: t`  ${fg(COL.dim)('"Find senior engineers with React experience"')}`,
      }),
    );
    examples.add(
      new TextRenderable(renderer, {
        id: uid("w-ex-2"),
        content: t`  ${fg(COL.dim)('"Show me candidates from top tech companies"')}`,
      }),
    );
    examples.add(
      new TextRenderable(renderer, {
        id: uid("w-ex-3"),
        content: t`  ${fg(COL.dim)('"Filter by location in San Francisco"')}`,
      }),
    );
    box.add(examples);

    // Keyboard shortcuts
    const keys = new BoxRenderable(renderer, {
      id: uid("w-keys"),
      flexDirection: "column",
      marginTop: 1,
    });
    keys.add(
      new TextRenderable(renderer, {
        id: uid("w-k-label"),
        content: t`${fg(theme.fgSecondary)("Keyboard:")}`,
      }),
    );
    keys.add(
      new TextRenderable(renderer, {
        id: uid("w-k-1"),
        content: t`  ${fg(theme.fgSecondary)("Tab")}${fg(COL.dim)("  switch panel")}    ${fg(theme.fgSecondary)("j/k")}${fg(COL.dim)("  navigate")}`,
      }),
    );
    keys.add(
      new TextRenderable(renderer, {
        id: uid("w-k-2"),
        content: t`  ${fg(theme.fgSecondary)("Esc")}${fg(COL.dim)("  go back")}        ${fg(theme.fgSecondary)("0-9")}${fg(COL.dim)("  profile detail")}`,
      }),
    );
    box.add(keys);

    // Commands
    const cmds = new BoxRenderable(renderer, {
      id: uid("w-cmds"),
      flexDirection: "column",
      marginTop: 1,
    });
    cmds.add(
      new TextRenderable(renderer, {
        id: uid("w-c-label"),
        content: t`${fg(theme.fgSecondary)("Commands:")}`,
      }),
    );
    cmds.add(
      new TextRenderable(renderer, {
        id: uid("w-c-1"),
        content: t`  ${fg(theme.fgSecondary)("/help")}${fg(COL.dim)("  show help")}    ${fg(theme.fgSecondary)("/detail n")}${fg(COL.dim)("  view profile")}`,
      }),
    );
    cmds.add(
      new TextRenderable(renderer, {
        id: uid("w-c-2"),
        content: t`  ${fg(theme.fgSecondary)("/clear")}${fg(COL.dim)(" reset")}       ${fg(theme.fgSecondary)("/quit")}${fg(COL.dim)("     exit")}`,
      }),
    );
    box.add(cmds);

    addContent(box);
  }

  function renderHelp(): void {
    const box = new BoxRenderable(renderer, {
      id: uid("help"),
      padding: 1,
      flexDirection: "column",
    });

    box.add(
      new TextRenderable(renderer, {
        id: uid("help-title"),
        content: t`${bold(fg(theme.fg)("Help"))}`,
      }),
    );

    // Slash commands
    box.add(
      new TextRenderable(renderer, {
        id: uid("help-cmd-label"),
        content: t`\n${fg(theme.fgSecondary)("Slash Commands")}`,
      }),
    );
    const commands = [
      ["/help, /h", "Show this help"],
      ["/detail <n>, /d <n>", "View profile at index n"],
      ["/clear", "Clear results and search history"],
      ["/quit, /q", "Exit the TUI"],
    ];
    for (const [cmd, desc] of commands) {
      box.add(
        new TextRenderable(renderer, {
          id: uid("help-cmd"),
          content: t`  ${fg(theme.blue)(pad(cmd!, 22))}${fg(COL.dim)(desc!)}`,
        }),
      );
    }

    // Keyboard shortcuts
    box.add(
      new TextRenderable(renderer, {
        id: uid("help-key-label"),
        content: t`\n${fg(theme.fgSecondary)("Keyboard Shortcuts")}`,
      }),
    );
    const shortcuts = [
      ["Tab", "Cycle focus: input -> results -> history"],
      ["Enter", "Submit search or select history item"],
      ["Esc", "Go back to results / return to input"],
      ["j / Down", "Navigate down (history, scroll results)"],
      ["k / Up", "Navigate up (history, scroll results)"],
      ["0-9", "Quick view: show profile detail at index"],
      ["q", "Quit (when input is not focused)"],
      ["Ctrl+C", "Force quit"],
    ];
    for (const [key, desc] of shortcuts) {
      box.add(
        new TextRenderable(renderer, {
          id: uid("help-key"),
          content: t`  ${fg(theme.blue)(pad(key!, 22))}${fg(COL.dim)(desc!)}`,
        }),
      );
    }

    addContent(box);
  }

  function renderError(error: string): void {
    const box = new BoxRenderable(renderer, {
      id: uid("error"),
      padding: 1,
    });
    box.add(
      new TextRenderable(renderer, {
        id: uid("err-text"),
        content: t`${fg(COL.error)("Error:")} ${error}`,
      }),
    );
    addContent(box);
  }

  function renderSearchResults(result: SearchResult): void {
    // Header
    addContent(
      new TextRenderable(renderer, {
        id: uid("search-header"),
        content: t`${bold(fg(COL.accent)("Search:"))} ${result.query}`,
        paddingLeft: 1,
        paddingRight: 1,
      }),
    );

    addContent(
      new TextRenderable(renderer, {
        id: uid("search-meta"),
        content: t`${fg(COL.dim)(`${result.totalMatches} total matches. Showing ${result.profiles.length}.`)}`,
        paddingLeft: 1,
        paddingRight: 1,
      }),
    );

    if (result.profiles.length === 0) {
      addContent(
        new TextRenderable(renderer, {
          id: uid("no-results"),
          content: t`${fg(COL.dim)("No profiles found.")}`,
          padding: 1,
        }),
      );
      if (result.summary) {
        addContent(
          new TextRenderable(renderer, {
            id: uid("summary"),
            content: t`${fg(COL.dim)(result.summary)}`,
            paddingLeft: 1,
          }),
        );
      }
      return;
    }

    // Column widths
    const W = { idx: 3, name: 20, role: 20, location: 16, lang: 18 };

    // Table header row
    const headerRow = new BoxRenderable(renderer, {
      id: uid("table-header"),
      paddingLeft: 1,
      paddingRight: 1,
      marginTop: 1,
      flexDirection: "row",
    });
    headerRow.add(
      new TextRenderable(renderer, {
        id: uid("h-idx"),
        content: t`${bold(fg(COL.header)(pad("#", W.idx)))}`,
      }),
    );
    headerRow.add(
      new TextRenderable(renderer, {
        id: uid("h-name"),
        content: t`${bold(fg(COL.header)(pad("Name", W.name)))}`,
      }),
    );
    headerRow.add(
      new TextRenderable(renderer, {
        id: uid("h-role"),
        content: t`${bold(fg(COL.header)(pad("Role", W.role)))}`,
      }),
    );
    headerRow.add(
      new TextRenderable(renderer, {
        id: uid("h-loc"),
        content: t`${bold(fg(COL.header)(pad("Location", W.location)))}`,
      }),
    );
    headerRow.add(
      new TextRenderable(renderer, {
        id: uid("h-lang"),
        content: t`${bold(fg(COL.header)(pad("Languages", W.lang)))}`,
      }),
    );
    addContent(headerRow);

    // Separator
    addContent(
      new TextRenderable(renderer, {
        id: uid("separator"),
        content: t`${fg(COL.dim)("─".repeat(W.idx + W.name + W.role + W.location + W.lang))}`,
        paddingLeft: 1,
      }),
    );

    // Data rows
    for (let i = 0; i < result.profiles.length; i++) {
      const p = result.profiles[i]!;
      const name = truncate(p.displayName || p.name || "Unknown", W.name);
      const role = truncate(p.mainRole || p.linkedinCurrentTitle || "", W.role);
      const location = truncate(p.location || "", W.location);
      const languages = truncate(p.githubTopLanguages || "", W.lang);

      const row = new BoxRenderable(renderer, {
        id: uid("row"),
        paddingLeft: 1,
        paddingRight: 1,
        flexDirection: "row",
        backgroundColor: i % 2 === 0 ? undefined : theme.bgCard,
      });
      row.add(
        new TextRenderable(renderer, {
          id: uid("r-idx"),
          content: t`${fg(COL.warn)(pad(String(i), W.idx))}`,
        }),
      );
      row.add(
        new TextRenderable(renderer, {
          id: uid("r-name"),
          content: t`${fg(COL.name)(pad(name, W.name))}`,
        }),
      );
      row.add(
        new TextRenderable(renderer, {
          id: uid("r-role"),
          content: t`${fg(COL.role)(pad(role, W.role))}`,
        }),
      );
      row.add(
        new TextRenderable(renderer, {
          id: uid("r-loc"),
          content: t`${fg(COL.location)(pad(location, W.location))}`,
        }),
      );
      row.add(
        new TextRenderable(renderer, {
          id: uid("r-lang"),
          content: t`${fg(COL.lang)(pad(languages, W.lang))}`,
        }),
      );
      addContent(row);
    }

    // Footer
    const footer = new BoxRenderable(renderer, {
      id: uid("footer"),
      paddingLeft: 1,
      paddingRight: 1,
      marginTop: 1,
      flexDirection: "column",
    });
    footer.add(
      new TextRenderable(renderer, {
        id: uid("f-session"),
        content: t`${fg(COL.dim)(`Session: ${result.session}`)}`,
      }),
    );
    footer.add(
      new TextRenderable(renderer, {
        id: uid("f-hints"),
        content: t`${fg(COL.dim)("/detail <n> or 0-9 for profile details")}`,
      }),
    );
    addContent(footer);
  }

  function renderDetailView(result: DetailResult): void {
    const p = result.profile;

    // Header
    addContent(
      new TextRenderable(renderer, {
        id: uid("detail-header"),
        content: t`${bold(fg(COL.accent)("Profile Detail"))}`,
        paddingLeft: 1,
        marginBottom: 1,
      }),
    );

    // Identity section
    const identity = new BoxRenderable(renderer, {
      id: uid("identity"),
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "column",
    });
    identity.add(
      new TextRenderable(renderer, {
        id: uid("id-name"),
        content: t`${bold(fg(COL.name)(p.displayName || p.name || "Unknown"))}`,
      }),
    );
    if (p.mainRole)
      identity.add(
        new TextRenderable(renderer, {
          id: uid("id-role"),
          content: t`${fg(COL.role)(p.mainRole)}`,
        }),
      );
    if (p.location)
      identity.add(
        new TextRenderable(renderer, {
          id: uid("id-loc"),
          content: t`${fg(COL.dim)(p.location)}`,
        }),
      );
    if (p.tags?.length)
      identity.add(
        new TextRenderable(renderer, {
          id: uid("id-tags"),
          content: t`${fg(COL.lang)(p.tags.join(" · "))}`,
        }),
      );
    addContent(identity);

    // Bio
    if (p.bio) {
      const bioSection = new BoxRenderable(renderer, {
        id: uid("bio"),
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
        flexDirection: "column",
      });
      bioSection.add(
        new TextRenderable(renderer, {
          id: uid("bio-label"),
          content: t`${bold("Bio")}`,
        }),
      );
      bioSection.add(
        new TextRenderable(renderer, {
          id: uid("bio-text"),
          content: `  ${p.bio}`,
        }),
      );
      addContent(bioSection);
    }

    // GitHub
    if (p.github) {
      const gh = new BoxRenderable(renderer, {
        id: uid("github"),
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
        flexDirection: "column",
      });
      gh.add(
        new TextRenderable(renderer, {
          id: uid("gh-label"),
          content: t`${bold(fg(COL.accent)("GitHub"))}`,
        }),
      );
      if (p.github.topLanguages)
        gh.add(
          new TextRenderable(renderer, {
            id: uid("gh-lang"),
            content: `  Languages: ${p.github.topLanguages}`,
          }),
        );
      if (p.github.topFrameworks)
        gh.add(
          new TextRenderable(renderer, {
            id: uid("gh-fw"),
            content: `  Frameworks: ${p.github.topFrameworks}`,
          }),
        );
      if (p.github.expertiseLevel)
        gh.add(
          new TextRenderable(renderer, {
            id: uid("gh-exp"),
            content: `  Expertise: ${p.github.expertiseLevel}`,
          }),
        );
      if (p.github.developerArchetype)
        gh.add(
          new TextRenderable(renderer, {
            id: uid("gh-arch"),
            content: `  Archetype: ${p.github.developerArchetype}`,
          }),
        );
      if (p.github.totalContributions != null)
        gh.add(
          new TextRenderable(renderer, {
            id: uid("gh-contrib"),
            content: `  Contributions: ${p.github.totalContributions}`,
          }),
        );
      if (p.github.isRecentlyActive != null) {
        gh.add(
          new TextRenderable(renderer, {
            id: uid("gh-active"),
            content: `  Recently Active: ${p.github.isRecentlyActive ? "Yes" : "No"}`,
          }),
        );
      }

      if (p.github.activitySummary?.summary) {
        gh.add(
          new TextRenderable(renderer, {
            id: uid("gh-sum-label"),
            content: t`  ${bold("Activity Summary")}`,
          }),
        );
        const wrapped = wordWrap(p.github.activitySummary.summary, 65);
        for (const line of wrapped) {
          gh.add(
            new TextRenderable(renderer, {
              id: uid("gh-sum"),
              content: `  ${line}`,
            }),
          );
        }
        if (p.github.activitySummary.focusAreas) {
          gh.add(
            new TextRenderable(renderer, {
              id: uid("gh-focus"),
              content: t`  ${fg(COL.dim)(`Focus: ${p.github.activitySummary.focusAreas}`)}`,
            }),
          );
        }
      }
      addContent(gh);
    }

    // LinkedIn
    if (p.linkedin) {
      const li = new BoxRenderable(renderer, {
        id: uid("linkedin"),
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
        flexDirection: "column",
      });
      li.add(
        new TextRenderable(renderer, {
          id: uid("li-label"),
          content: t`${bold(fg(COL.linkedin)("LinkedIn"))}`,
        }),
      );
      if (p.linkedin.currentTitle) {
        const company = p.linkedin.currentCompany
          ? ` at ${p.linkedin.currentCompany}`
          : "";
        li.add(
          new TextRenderable(renderer, {
            id: uid("li-current"),
            content: `  Current: ${p.linkedin.currentTitle}${company}`,
          }),
        );
      }
      if (p.linkedin.totalYearsExperience != null) {
        li.add(
          new TextRenderable(renderer, {
            id: uid("li-years"),
            content: `  Experience: ${p.linkedin.totalYearsExperience} years`,
          }),
        );
      }
      addContent(li);
    }

    // Work Experience
    if (p.workExperience && p.workExperience.length > 0) {
      const exp = new BoxRenderable(renderer, {
        id: uid("work"),
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
        flexDirection: "column",
      });
      exp.add(
        new TextRenderable(renderer, {
          id: uid("work-label"),
          content: t`${bold("Work Experience")}`,
        }),
      );
      for (const e of p.workExperience) {
        const current = e.isCurrent ? " (current)" : "";
        const duration = e.durationMonths
          ? ` · ${Math.floor(e.durationMonths / 12)}y ${e.durationMonths % 12}m`
          : "";
        exp.add(
          new TextRenderable(renderer, {
            id: uid("work-entry"),
            content: t`  ${fg(COL.name)(e.title)} at ${e.company}${current}${fg(COL.dim)(duration)}`,
          }),
        );
        if (e.description) {
          exp.add(
            new TextRenderable(renderer, {
              id: uid("work-desc"),
              content: t`    ${fg(COL.dim)(truncate(e.description, 60))}`,
            }),
          );
        }
      }
      addContent(exp);
    }

    // Education
    if (p.education && p.education.length > 0) {
      const edu = new BoxRenderable(renderer, {
        id: uid("edu"),
        paddingLeft: 1,
        paddingRight: 1,
        marginTop: 1,
        flexDirection: "column",
      });
      edu.add(
        new TextRenderable(renderer, {
          id: uid("edu-label"),
          content: t`${bold("Education")}`,
        }),
      );
      for (const e of p.education) {
        const years =
          e.startYear && e.endYear ? ` (${e.startYear}-${e.endYear})` : "";
        edu.add(
          new TextRenderable(renderer, {
            id: uid("edu-entry"),
            content: t`  ${e.degree || "Degree"} in ${e.fieldOfStudy || "N/A"} - ${e.school}${fg(COL.dim)(years)}`,
          }),
        );
      }
      addContent(edu);
    }

    // Footer
    addContent(
      new TextRenderable(renderer, {
        id: uid("detail-footer"),
        content: t`${fg(COL.dim)("[Esc] back to results")}`,
        paddingLeft: 1,
        marginTop: 1,
      }),
    );
  }

  // Initial render
  render();

  return {
    container,
    scrollBox,
    update: (newState: Partial<ResultsState>) => {
      Object.assign(state, newState);
      render();
    },
    showHelp: () => {
      state.result = null;
      state.loading = false;
      clearContent();
      renderHelp();
    },
    getState: () => state,
  };
}
