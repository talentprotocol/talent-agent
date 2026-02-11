/**
 * TUI theme system with automatic light/dark mode detection.
 *
 * Colors are aligned with the talent-pro design system defined in:
 *   packages/tailwind-config/shared-styles.css
 *
 * Detection order:
 *   1. TALENT_CLI_THEME env var ("light" | "dark")
 *   2. COLORFGBG env var (set by some terminal emulators)
 *   3. macOS system appearance (AppleInterfaceStyle)
 *   4. Default: "dark"
 */
import { execSync } from "node:child_process";

// ─── Types ──────────────────────────────────────────────────────────────────

export type ColorScheme = "light" | "dark";

export interface Theme {
  colorScheme: ColorScheme;

  // Backgrounds
  bg: string;
  bgCard: string;
  bgSecondary: string;

  // Text
  fg: string;
  fgSecondary: string;
  fgMuted: string;

  // Borders
  border: string;
  borderFocus: string;
  ring: string;

  // Semantic
  success: string;
  destructive: string;
  warning: string;

  // Accent / Charts
  blue: string;
  teal: string;
  violet: string;

  // Brand
  linkedin: string;
}

// ─── Dark Theme (neutral palette) ───────────────────────────────────────────

const darkTheme: Theme = {
  colorScheme: "dark",

  // Backgrounds
  bg: "#0a0a0a", // --background  (neutral.950)
  bgCard: "#171717", // --card        (neutral.900)
  bgSecondary: "#262626", // --secondary   (neutral.800)

  // Text
  fg: "#fafafa", // --foreground          (neutral.50)
  fgSecondary: "#a3a3a3", // --                    (neutral.400)
  fgMuted: "#737373", // --muted-foreground    (neutral.500)

  // Borders
  border: "#3a3a3a", // --border  (neutral.750 -- visible on dark bg)
  borderFocus: "#737373", // --        (neutral.500 -- clear focus highlight)
  ring: "#525252", // --ring    (neutral.600)

  // Semantic
  success: "#10b981", // --success      (emerald.500)
  destructive: "#dc2626", // --destructive  (red.600)
  warning: "#f59e0b", // --warning      (amber.500)

  // Accent / Charts
  blue: "#d4d4d4", // neutral.300 (light gray accent on dark bg)
  teal: "#2dd4bf", // --chart-2  (teal.400)
  violet: "#a78bfa", // --chart-5  (violet.400)

  // Brand
  linkedin: "#0a66c2",
};

// ─── Light Theme (gray palette, .700 shades for WCAG AA text contrast) ──────

const lightTheme: Theme = {
  colorScheme: "light",

  // Backgrounds
  bg: "#f9fafb", // --background  (gray.50)
  bgCard: "#f3f4f6", // --card        (gray.100 -- visible on white)
  bgSecondary: "#e5e7eb", // --secondary   (gray.200)

  // Text
  fg: "#030712", // --foreground          (gray.950)
  fgSecondary: "#374151", // --                    (gray.700 -- 8.6:1 on white)
  fgMuted: "#4b5563", // --muted-foreground    (gray.600 -- 7.0:1 on white)

  // Borders
  border: "#d1d5db", // --border  (gray.300 -- visible on white bg)
  borderFocus: "#374151", // --        (gray.700)
  ring: "#6b7280", // --ring    (gray.500)

  // Semantic (use .700 shades -- .500 fails contrast on white)
  success: "#047857", // emerald.700  (5.1:1 on white)
  destructive: "#b91c1c", // red.700      (5.3:1 on white)
  warning: "#b45309", // amber.700    (4.8:1 on white)

  // Accent / Charts
  blue: "#1c1917", // stone.900 (near-black accent on light bg)
  teal: "#0f766e", // teal.700     (5.1:1 on white)
  violet: "#6d28d9", // violet.700   (7.4:1 on white)

  // Brand
  linkedin: "#0a66c2",
};

// ─── Active Theme ───────────────────────────────────────────────────────────

export let theme: Theme = darkTheme;

/**
 * Detect the terminal color scheme and set the active theme.
 * Call this once at startup, before creating any TUI components.
 */
export function initTheme(): void {
  const scheme = detectColorScheme();
  theme = scheme === "light" ? lightTheme : darkTheme;
}

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Detect the terminal's color scheme using a chain of heuristics.
 */
export function detectColorScheme(): ColorScheme {
  // 1. Explicit override via env var
  const override = process.env.TALENT_CLI_THEME?.toLowerCase();
  if (override === "light" || override === "dark") return override;

  // 2. COLORFGBG (set by some terminal emulators, e.g. rxvt, iTerm2)
  //    Format: "fg;bg" where values are ANSI color numbers (0-15).
  //    0-6 and 8 are dark backgrounds; 7 and 9-15 are light.
  const colorfgbg = process.env.COLORFGBG;
  if (colorfgbg) {
    const parts = colorfgbg.split(";");
    const bg = parseInt(parts[parts.length - 1] ?? "", 10);
    if (!isNaN(bg)) {
      return bg >= 7 && bg !== 8 ? "light" : "dark";
    }
  }

  // 3. macOS system appearance (AppleInterfaceStyle)
  //    "Dark" when dark mode is enabled; key absent in light mode.
  if (process.platform === "darwin") {
    try {
      const result = execSync("defaults read -g AppleInterfaceStyle", {
        encoding: "utf8",
        timeout: 500,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      return result === "Dark" ? "dark" : "light";
    } catch {
      // Key doesn't exist -> macOS is in light mode
      return "light";
    }
  }

  // 4. Default to dark
  return "dark";
}
