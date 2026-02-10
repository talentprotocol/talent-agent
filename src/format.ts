/**
 * Terminal formatters for displaying profile results in human-readable format.
 *
 * Used by both single-shot mode (stdout) and the TUI results panel.
 */
import type { DetailedProfile } from "../../talent-apps/apps/talent-pro/app/lib/services/tools/get-profile-details";
import type {
  AgentResult,
  DetailResult,
  ProfileSummary,
  SearchResult,
} from "./agent";

// ─── ANSI Colors ─────────────────────────────────────────────────────────────

const NO_COLOR = "NO_COLOR" in process.env;
const RESET = NO_COLOR ? "" : "\x1b[0m";
const BOLD = NO_COLOR ? "" : "\x1b[1m";
const DIM = NO_COLOR ? "" : "\x1b[2m";
const CYAN = NO_COLOR ? "" : "\x1b[36m";
const GREEN = NO_COLOR ? "" : "\x1b[32m";
const YELLOW = NO_COLOR ? "" : "\x1b[33m";
const MAGENTA = NO_COLOR ? "" : "\x1b[35m";
const WHITE = NO_COLOR ? "" : "\x1b[37m";
const GRAY = NO_COLOR ? "" : "\x1b[90m";
const BLUE = NO_COLOR ? "" : "\x1b[34m";
const RED = NO_COLOR ? "" : "\x1b[31m";

// ─── Profile Table Formatter ─────────────────────────────────────────────────

function pad(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

function truncate(
  str: string | string[] | null | undefined,
  maxLen: number,
): string {
  if (!str) return "";
  const s = Array.isArray(str) ? str.join(", ") : str;
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + "…";
}

export function formatSearchResult(result: SearchResult): string {
  const lines: string[] = [];

  // Header
  lines.push("");
  lines.push(`${BOLD}${CYAN}Search:${RESET} ${result.query}`);
  lines.push(
    `${DIM}${result.totalMatches} total matches. Showing ${result.profiles.length}.${RESET}`,
  );
  lines.push(`${DIM}Session: ${result.session}${RESET}`);
  lines.push("");

  if (result.profiles.length === 0) {
    lines.push(`${DIM}  No profiles found.${RESET}`);
    if (result.summary) {
      lines.push("");
      lines.push(`  ${result.summary}`);
    }
    lines.push("");
    return lines.join("\n");
  }

  // Table header
  const colWidths = { idx: 3, name: 22, role: 22, location: 18, languages: 20 };
  lines.push(
    `${BOLD}${WHITE}  ${pad("#", colWidths.idx)} ${pad("Name", colWidths.name)} ${pad("Role", colWidths.role)} ${pad("Location", colWidths.location)} ${pad("Languages", colWidths.languages)}${RESET}`,
  );
  lines.push(
    `${DIM}  ${"─".repeat(colWidths.idx + colWidths.name + colWidths.role + colWidths.location + colWidths.languages + 4)}${RESET}`,
  );

  // Rows
  for (let i = 0; i < result.profiles.length; i++) {
    const p = result.profiles[i]!;
    const name = truncate(p.displayName || p.name || "Unknown", colWidths.name);
    const role = truncate(
      p.mainRole || p.linkedinCurrentTitle || "",
      colWidths.role,
    );
    const location = truncate(p.location || "", colWidths.location);
    const languages = truncate(p.githubTopLanguages || "", colWidths.languages);

    lines.push(
      `  ${YELLOW}${pad(String(i), colWidths.idx)}${RESET} ${GREEN}${pad(name, colWidths.name)}${RESET} ${pad(role, colWidths.role)} ${DIM}${pad(location, colWidths.location)}${RESET} ${MAGENTA}${pad(languages, colWidths.languages)}${RESET}`,
    );
  }

  lines.push("");

  // Summary
  if (result.summary) {
    lines.push(`${DIM}${result.summary}${RESET}`);
    lines.push("");
  }

  // Hints
  lines.push(
    `${DIM}Use --session ${result.session} to refine. Use --detail <index> to view a profile.${RESET}`,
  );
  lines.push("");

  return lines.join("\n");
}

// ─── Detail Formatter ────────────────────────────────────────────────────────

export function formatDetailResult(result: DetailResult): string {
  const lines: string[] = [];
  const p = result.profile;

  lines.push("");
  lines.push(`${BOLD}${CYAN}═══ Profile Detail ═══${RESET}`);
  lines.push("");

  // Identity
  lines.push(`${BOLD}${GREEN}${p.displayName || p.name || "Unknown"}${RESET}`);
  if (p.mainRole) lines.push(`${WHITE}${p.mainRole}${RESET}`);
  if (p.location) lines.push(`${DIM}${p.location}${RESET}`);
  if (p.tags?.length) lines.push(`${MAGENTA}${p.tags.join(" · ")}${RESET}`);
  lines.push("");

  // Bio
  if (p.bio) {
    lines.push(`${BOLD}Bio${RESET}`);
    lines.push(`  ${p.bio}`);
    lines.push("");
  }

  // GitHub
  if (p.github) {
    lines.push(`${BOLD}${CYAN}GitHub${RESET}`);
    if (p.github.topLanguages)
      lines.push(`  Languages: ${p.github.topLanguages}`);
    if (p.github.topFrameworks)
      lines.push(`  Frameworks: ${p.github.topFrameworks}`);
    if (p.github.expertiseLevel)
      lines.push(`  Expertise: ${p.github.expertiseLevel}`);
    if (p.github.developerArchetype)
      lines.push(`  Archetype: ${p.github.developerArchetype}`);
    if (p.github.totalContributions != null)
      lines.push(`  Contributions: ${p.github.totalContributions}`);
    if (p.github.isRecentlyActive != null) {
      lines.push(
        `  Recently Active: ${p.github.isRecentlyActive ? "Yes" : "No"}`,
      );
    }
    if (p.github.activitySummary?.summary) {
      lines.push("");
      lines.push(`  ${BOLD}Activity Summary${RESET}`);
      // Wrap summary text
      const words = p.github.activitySummary.summary.split(" ");
      let line = "  ";
      for (const word of words) {
        if (line.length + word.length > 78) {
          lines.push(line);
          line = "  " + word;
        } else {
          line += (line.length > 2 ? " " : "") + word;
        }
      }
      if (line.trim()) lines.push(line);
      if (p.github.activitySummary.focusAreas) {
        lines.push(
          `  ${DIM}Focus: ${p.github.activitySummary.focusAreas}${RESET}`,
        );
      }
    }
    lines.push("");
  }

  // LinkedIn / Work Experience
  if (p.linkedin) {
    lines.push(`${BOLD}${BLUE}LinkedIn${RESET}`);
    if (p.linkedin.currentTitle)
      lines.push(
        `  Current: ${p.linkedin.currentTitle}${p.linkedin.currentCompany ? ` at ${p.linkedin.currentCompany}` : ""}`,
      );
    if (p.linkedin.totalYearsExperience != null)
      lines.push(`  Experience: ${p.linkedin.totalYearsExperience} years`);
    lines.push("");
  }

  if (p.workExperience && p.workExperience.length > 0) {
    lines.push(`${BOLD}Work Experience${RESET}`);
    for (const exp of p.workExperience) {
      const current = exp.isCurrent ? " (current)" : "";
      const duration = exp.durationMonths
        ? ` · ${Math.round(exp.durationMonths / 12)}y ${exp.durationMonths % 12}m`
        : "";
      lines.push(
        `  ${GREEN}${exp.title}${RESET} at ${exp.company}${current}${DIM}${duration}${RESET}`,
      );
      if (exp.description) {
        lines.push(`    ${DIM}${truncate(exp.description, 70)}${RESET}`);
      }
    }
    lines.push("");
  }

  // Education
  if (p.education && p.education.length > 0) {
    lines.push(`${BOLD}Education${RESET}`);
    for (const edu of p.education) {
      const years =
        edu.startYear && edu.endYear
          ? ` (${edu.startYear}-${edu.endYear})`
          : "";
      lines.push(
        `  ${edu.degree || "Degree"} in ${edu.fieldOfStudy || "N/A"} - ${edu.school}${DIM}${years}${RESET}`,
      );
    }
    lines.push("");
  }

  // Session hint
  lines.push(`${DIM}Session: ${result.session}${RESET}`);
  lines.push("");

  return lines.join("\n");
}

// ─── Error Formatter ─────────────────────────────────────────────────────────

export function formatError(error: string, session?: string): string {
  return `\n${RED}Error:${RESET} ${error}${session ? `\n${DIM}Session: ${session}${RESET}` : ""}\n`;
}

// ─── JSON Formatters ─────────────────────────────────────────────────────────

export function toJSON(result: AgentResult): string {
  return JSON.stringify(result, null, 2);
}
