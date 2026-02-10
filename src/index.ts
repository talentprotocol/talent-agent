#!/usr/bin/env bun
/**
 * Talent Search CLI
 *
 * A search engine for talent profiles powered by the Talent Agent.
 *
 * Usage:
 *   talent-cli "Find React developers in Berlin"        # Single-shot search
 *   talent-cli --json "Find senior Python engineers"     # JSON output
 *   talent-cli --session abc "Only show seniors"         # Refine previous search
 *   talent-cli --session abc --detail 0                  # Detail on 1st result
 *   talent-cli                                           # Interactive TUI
 *   echo '{"query":"..."}' | talent-cli --pipe           # JSONL piped mode
 *   talent-cli --serve                                   # MCP server mode
 *   talent-cli session save <id> <path>                  # Save session to file
 *   talent-cli session load <path>                       # Load session from file
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadEnv, validateEnv } from "./env";
import {
  EXIT_APP_ERROR,
  EXIT_AUTH_ERROR,
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
} from "./errors";

// ─── Argument Parsing (before env loading so --help works without .env) ──────

type AuthMethod = "email" | "google" | "wallet";

interface CliArgs {
  mode:
    | "interactive"
    | "single-shot"
    | "pipe"
    | "serve"
    | "session-cmd"
    | "login"
    | "logout"
    | "whoami";
  query?: string;
  session?: string;
  detail?: number;
  json: boolean;
  help: boolean;
  version: boolean;
  debug: boolean;
  sessionCmd?:
    | { action: "save"; id: string; path: string }
    | { action: "load"; path: string };
  loginMethod?: AuthMethod;
}

function getVersion(): string {
  try {
    const pkgPath = resolve(import.meta.dir, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    mode: "interactive",
    json: false,
    help: false,
    version: false,
    debug: false,
  };

  let i = 0;
  const positional: string[] = [];

  // Check for subcommands
  if (args[0] === "login") {
    result.mode = "login";
    // Check for --email, --google, --wallet flags
    if (args[1] === "--email") result.loginMethod = "email";
    else if (args[1] === "--google") result.loginMethod = "google";
    else if (args[1] === "--wallet") result.loginMethod = "wallet";
    return result;
  }

  if (args[0] === "logout") {
    result.mode = "logout";
    return result;
  }

  if (args[0] === "whoami") {
    result.mode = "whoami";
    return result;
  }

  if (args[0] === "session") {
    const subAction = args[1];
    if (subAction === "save" && args[2] && args[3]) {
      result.mode = "session-cmd";
      result.sessionCmd = { action: "save", id: args[2], path: args[3] };
      return result;
    } else if (subAction === "load" && args[2]) {
      result.mode = "session-cmd";
      result.sessionCmd = { action: "load", path: args[2] };
      return result;
    } else {
      console.error("Usage: talent-cli session save <id> <path>");
      console.error("       talent-cli session load <path>");
      process.exit(EXIT_USAGE_ERROR);
    }
  }

  while (i < args.length) {
    const arg = args[i]!;
    switch (arg) {
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--version":
      case "-v":
        result.version = true;
        break;
      case "--json":
      case "-j":
        result.json = true;
        break;
      case "--pipe":
      case "-p":
        result.mode = "pipe";
        break;
      case "--serve":
        result.mode = "serve";
        break;
      case "--debug":
      case "-D":
        result.debug = true;
        break;
      case "--session":
      case "-s":
        result.session = args[++i];
        break;
      case "--detail":
      case "-d":
        result.detail = parseInt(args[++i] ?? "0", 10);
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown flag: ${arg}`);
          process.exit(EXIT_USAGE_ERROR);
        }
        positional.push(arg);
    }
    i++;
  }

  // If positional args provided, it's a single-shot query
  if (positional.length > 0) {
    result.mode = "single-shot";
    result.query = positional.join(" ");
  }

  // TALENT_CLI_SESSION env var fallback
  if (!result.session && process.env.TALENT_CLI_SESSION) {
    result.session = process.env.TALENT_CLI_SESSION;
  }

  // Detect piped stdin (non-TTY)
  if (result.mode === "interactive" && !process.stdin.isTTY) {
    result.mode = "pipe";
  }

  // Auto-enable JSON when stdout is not a TTY (piping to another program)
  if (result.mode === "single-shot" && !process.stdout.isTTY) {
    result.json = true;
  }

  return result;
}

function printHelp(): void {
  console.log(`
Talent Search CLI - Search for talent profiles using natural language

USAGE:
  talent-cli [OPTIONS] [QUERY]

AUTHENTICATION:
  talent-cli login                                  # Interactive login (choose method)
  talent-cli login --email                          # Login with email (magic code)
  talent-cli login --google                         # Login with Google
  talent-cli login --wallet                         # Login with wallet (SIWE)
  talent-cli logout                                 # Clear stored credentials
  talent-cli whoami                                 # Show current auth status

SEARCH:
  talent-cli "Find React developers in Berlin"
  talent-cli --json "Find senior Python engineers"
  talent-cli --session abc123 "Only show those from Google"
  talent-cli --session abc123 --detail 0
  talent-cli                                        # Interactive TUI
  echo '{"query":"Find Rust devs"}' | talent-cli --pipe
  talent-cli --serve                                # MCP server mode
  talent-cli session save abc123 ./search.json      # Save session
  talent-cli session load ./search.json             # Load session

OPTIONS:
  -h, --help              Show this help message
  -v, --version           Show version number
  -j, --json              Output results as JSON
  -s, --session <id>      Continue a previous search session (for refinement)
  -d, --detail <index>    Show detailed profile at index from last search
  -p, --pipe              JSONL mode: read queries from stdin, write results to stdout
  -D, --debug             Print diagnostic info to stderr
  --serve                 Start as MCP server (stdio transport)

ENVIRONMENT VARIABLES:
  TALENT_PROTOCOL_API_URL  Talent Protocol API base URL
  TALENT_PROTOCOL_API_KEY  API key for the Talent Protocol API
  TALENT_PRO_URL           Talent Pro app URL (for agent API)
  TALENT_CLI_SESSION       Default session ID (fallback for --session)
  NO_COLOR                 Disable colored output

INTERACTIVE MODE:
  Default when no query is provided. Shows a two-column TUI with
  search history on the left and results on the right.

  Keyboard shortcuts:
    Tab          Switch focus between sidebar and search input
    Up/Down      Navigate search history (sidebar) or results
    Enter        Submit search / select history item
    d + number   Show detail for profile at that index
    n            Next page of results
    q / Ctrl+C   Quit
`);
}

function printHelpJson(): void {
  const version = getVersion();
  const schema = {
    name: "talent-cli",
    version,
    modes: {
      search: { usage: "talent-cli [--json] [--session <id>] <query>" },
      detail: { usage: "talent-cli --session <id> --detail <index>" },
      pipe: {
        usage: "talent-cli --pipe",
        inputSchema: "JSONL: {action, query?, session?, id?, index?}",
      },
      interactive: { usage: "talent-cli" },
      serve: { usage: "talent-cli --serve" },
    },
    flags: [
      "--json",
      "--session",
      "--detail",
      "--pipe",
      "--debug",
      "--serve",
      "--help",
      "--version",
    ],
    envVars: [
      "TALENT_PROTOCOL_API_URL",
      "TALENT_PROTOCOL_API_KEY",
      "TALENT_PRO_URL",
      "TALENT_CLI_SESSION",
      "NO_COLOR",
    ],
  };
  console.log(JSON.stringify(schema, null, 2));
}

// ─── Main ────────────────────────────────────────────────────────────────────

const cliArgs = parseArgs();

if (cliArgs.version) {
  console.log(getVersion());
  process.exit(EXIT_SUCCESS);
}

if (cliArgs.help && cliArgs.json) {
  printHelpJson();
  process.exit(EXIT_SUCCESS);
}

if (cliArgs.help) {
  printHelp();
  process.exit(EXIT_SUCCESS);
}

// Load and validate env after --help/--version check (so they work without .env)
loadEnv();

// ─── Auth Commands (need env but not full validation) ─────────────────────

if (cliArgs.mode === "login") {
  validateEnv();
  const { runInteractiveLogin } = await import("./auth/flows");
  try {
    await runInteractiveLogin(cliArgs.loginMethod);
    process.exit(EXIT_SUCCESS);
  } catch (error) {
    console.error(
      `Login failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(EXIT_AUTH_ERROR);
  }
}

if (cliArgs.mode === "logout") {
  const { clearCredentials } = await import("./auth/store");
  clearCredentials();
  console.log("Logged out. Credentials cleared.");
  process.exit(EXIT_SUCCESS);
}

if (cliArgs.mode === "whoami") {
  const { loadCredentials, isTokenExpired } = await import("./auth/store");
  const creds = loadCredentials();
  if (!creds) {
    console.log("Not authenticated. Run 'talent-cli login' to sign in.");
    process.exit(EXIT_SUCCESS);
  }
  const expired = isTokenExpired(creds.expiresAt);
  const expiresDate = new Date(
    creds.expiresAt > 1_000_000_000_000
      ? creds.expiresAt
      : creds.expiresAt * 1000,
  );
  console.log(`Auth method: ${creds.authMethod}`);
  if (creds.email) console.log(`Email:       ${creds.email}`);
  if (creds.address) console.log(`Address:     ${creds.address}`);
  console.log(`Token:       ${expired ? "EXPIRED" : "valid"}`);
  console.log(`Expires:     ${expiresDate.toLocaleString()}`);
  process.exit(EXIT_SUCCESS);
}

// ─── Session Commands ─────────────────────────────────────────────────────

if (cliArgs.mode === "session-cmd") {
  const { saveSession, loadSession } = await import("./agent");
  const cmd = cliArgs.sessionCmd!;
  try {
    if (cmd.action === "save") {
      saveSession(cmd.id, cmd.path);
      console.log(`Session "${cmd.id}" saved to ${cmd.path}`);
    } else {
      const sessionId = loadSession(cmd.path);
      console.log(`Session "${sessionId}" loaded from ${cmd.path}`);
    }
    process.exit(EXIT_SUCCESS);
  } catch (error) {
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(EXIT_APP_ERROR);
  }
}

// ─── Main Modes (require full env + auth) ─────────────────────────────────

validateEnv();

switch (cliArgs.mode) {
  case "single-shot": {
    const { runSingleShot } = await import("./programmatic/single-shot");
    await runSingleShot(
      cliArgs.query!,
      cliArgs.session,
      cliArgs.detail,
      cliArgs.json,
      cliArgs.debug,
    );
    break;
  }
  case "pipe": {
    const { runPiped } = await import("./programmatic/piped");
    await runPiped(cliArgs.debug);
    break;
  }
  case "serve": {
    const { startMcpServer } = await import("./mcp/server");
    await startMcpServer();
    break;
  }
  case "interactive": {
    const { runTUI } = await import("./tui/app");
    await runTUI();
    break;
  }
}
