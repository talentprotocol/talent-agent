/**
 * Results panel for the TUI.
 *
 * Renders profile search results as a formatted table, or a detailed
 * profile card when in detail view mode. Uses Renderables for dynamic updates.
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

import type {
  AgentResult,
  DetailResult,
  ProfileSummary,
  SearchResult,
} from "../agent";

// ─── Colors ──────────────────────────────────────────────────────────────────

const COL = {
  name: "#9ece6a", // green
  role: "#c0caf5", // white
  location: "#7aa2f7", // blue
  lang: "#bb9af7", // magenta
  dim: "#565f89", // gray
  accent: "#7dcfff", // cyan
  warn: "#e0af68", // yellow
  header: "#c0caf5", // white
  error: "#f7768e", // red
  linkedin: "#0a66c2", // linkedin blue
} as const;

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
 * Uses BoxRenderable so children can be dynamically replaced on update.
 */
export function createResultsPanel(renderer: CliRenderer) {
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
    borderColor: "#444444",
    title: " Results ",
    titleAlignment: "left",
    overflow: "hidden",
  });

  function clearContent(): void {
    for (const child of container.getChildren()) {
      container.remove(child.id);
    }
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
    container.add(box);
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
    box.add(
      new TextRenderable(renderer, {
        id: uid("w1"),
        content: t`${fg(COL.accent)("Talent Search")}`,
      }),
    );
    box.add(
      new TextRenderable(renderer, {
        id: uid("w2"),
        content: t`${dim("Type a query below to search for profiles")}`,
      }),
    );
    box.add(
      new TextRenderable(renderer, {
        id: uid("w3"),
        content: t`${dim('Example: "Find React developers in Lisbon"')}`,
      }),
    );
    container.add(box);
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
    container.add(box);
  }

  function renderSearchResults(result: SearchResult): void {
    // Header
    container.add(
      new TextRenderable(renderer, {
        id: uid("search-header"),
        content: t`${bold(fg(COL.accent)("Search:"))} ${result.query}`,
        paddingLeft: 1,
        paddingRight: 1,
      }),
    );

    container.add(
      new TextRenderable(renderer, {
        id: uid("search-meta"),
        content: t`${dim(`${result.totalMatches} total matches. Showing ${result.profiles.length}.`)}`,
        paddingLeft: 1,
        paddingRight: 1,
      }),
    );

    if (result.profiles.length === 0) {
      container.add(
        new TextRenderable(renderer, {
          id: uid("no-results"),
          content: t`${dim("No profiles found.")}`,
          padding: 1,
        }),
      );
      if (result.summary) {
        container.add(
          new TextRenderable(renderer, {
            id: uid("summary"),
            content: t`${dim(result.summary)}`,
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
    container.add(headerRow);

    // Separator
    container.add(
      new TextRenderable(renderer, {
        id: uid("separator"),
        content: t`${dim("─".repeat(W.idx + W.name + W.role + W.location + W.lang))}`,
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
        backgroundColor: i % 2 === 0 ? undefined : "#1a1b26",
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
      container.add(row);
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
        content: t`${dim(`Session: ${result.session}`)}`,
      }),
    );
    footer.add(
      new TextRenderable(renderer, {
        id: uid("f-hints"),
        content: t`${dim("[d + index] detail  [Esc] back  [Tab] switch panel")}`,
      }),
    );
    container.add(footer);
  }

  function renderDetailView(result: DetailResult): void {
    const p = result.profile;

    // Header
    container.add(
      new TextRenderable(renderer, {
        id: uid("detail-header"),
        content: t`${bold(fg(COL.accent)("═══ Profile Detail ═══"))}`,
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
          content: t`${dim(p.location)}`,
        }),
      );
    if (p.tags?.length)
      identity.add(
        new TextRenderable(renderer, {
          id: uid("id-tags"),
          content: t`${fg(COL.lang)(p.tags.join(" · "))}`,
        }),
      );
    container.add(identity);

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
      container.add(bioSection);
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
              content: t`  ${dim(`Focus: ${p.github.activitySummary.focusAreas}`)}`,
            }),
          );
        }
      }
      container.add(gh);
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
      container.add(li);
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
            content: t`  ${fg(COL.name)(e.title)} at ${e.company}${current}${dim(duration)}`,
          }),
        );
        if (e.description) {
          exp.add(
            new TextRenderable(renderer, {
              id: uid("work-desc"),
              content: t`    ${dim(truncate(e.description, 60))}`,
            }),
          );
        }
      }
      container.add(exp);
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
            content: t`  ${e.degree || "Degree"} in ${e.fieldOfStudy || "N/A"} - ${e.school}${dim(years)}`,
          }),
        );
      }
      container.add(edu);
    }

    // Footer
    container.add(
      new TextRenderable(renderer, {
        id: uid("detail-footer"),
        content: t`${dim("[Esc] back to results  [Tab] switch panel")}`,
        paddingLeft: 1,
        marginTop: 1,
      }),
    );
  }

  // Initial render
  render();

  return {
    container,
    update: (newState: Partial<ResultsState>) => {
      Object.assign(state, newState);
      render();
    },
    getState: () => state,
  };
}
