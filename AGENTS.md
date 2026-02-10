# AGENTS.md - Talent CLI

## Project Description

`talent-agent` is a standalone command-line tool for searching talent profiles using natural language, powered by the Talent Agent (an AI agent that wraps OpenSearch). It operates in three primary modes plus an MCP server mode:

1. **Single-shot mode**: Run a query from the command line, get results, exit.
2. **Pipe mode**: Read JSONL from stdin, write JSONL to stdout (for agent-to-agent communication).
3. **Interactive TUI mode**: A two-column terminal UI with search history and results.
4. **MCP server mode**: Expose tools via the Model Context Protocol for use by Claude, Cursor, etc.

## Architecture

```
src/
  index.ts                    # CLI entry point, argument parser, mode router
  agent.ts                    # Agent wrapper: sessions, query(), getDetail(), result extraction
  errors.ts                   # AI-friendly error rewriting + structured exit codes
  format.ts                   # Terminal formatters (ANSI) for human-readable output
  env.ts                      # Environment variable loading and validation
  lib.ts                      # Programmatic TS/JS API (TalentSearch class)
  programmatic/
    single-shot.ts            # Single-shot mode: query -> formatted or JSON output
    piped.ts                  # Pipe mode: JSONL stdin -> JSONL stdout with Zod validation
  tui/
    app.ts                    # TUI main: layout, keyboard handling, search execution
    results.ts                # TUI results panel: profile table / detail card
    sidebar.ts                # TUI sidebar: search history list
  mcp/
    server.ts                 # MCP server: talent_search, talent_detail, talent_refine tools
scripts/
  check-version.js            # Print package version (for CI)
skills/
  talent-agent/                 # Agent skill documentation
```

## Code Style

- **Double quotes** everywhere (enforced by Prettier)
- **Semicolons** always
- **No emojis** in code or output
- **Respect `NO_COLOR`**: all ANSI escape codes are gated on `NO_COLOR` env var
- **Debug to stderr**: `--debug` output goes to `process.stderr`, never `process.stdout`
- **Trailing commas** in all contexts
- **2-space indentation**
- Import order: external packages first, then local imports (sorted by `@trivago/prettier-plugin-sort-imports`)

## Agent Wrapper (`src/agent.ts`)

The agent wrapper manages conversation sessions in memory:

- `query(input, sessionId?, options?)` -> `{ result: AgentResult, meta: AgentMeta }`
- `getDetail(sessionId, profileIndex, options?)` -> `{ result: AgentResult, meta: AgentMeta }`
- Sessions store message history for refinement (multi-turn conversations)
- `saveSession(id, path)` / `loadSession(path)` for persistence
- Tool results are extracted from the AI SDK response steps (tool-call/tool-result content blocks)
- Errors are rewritten to AI-friendly messages via `toAIFriendlyError()`

## Key Types

- `AgentResult = SearchResult | DetailResult | ErrorResult`
- `AgentMeta = { durationMs, tokensUsed, toolsCalled }`
- JSON output uses a success/error envelope: `{ success: true, data, meta }` or `{ success: false, error, code }`

## Running

```bash
bun run start                           # Run the CLI
bun run start -- "Find React devs"      # Single-shot
bun run start -- --json "Find devs"     # JSON output
bun run start -- --serve                # MCP server
bun run test                            # Run tests
bun run test:watch                      # Run tests in watch mode
bun run typecheck                       # Type checking
bun run format                          # Format code
```

## Testing

Tests use [vitest](https://vitest.dev/) and live alongside source files as `*.test.ts`. The test infrastructure includes:

- **External dependencies** (e.g. `@opentui/core`, `@modelcontextprotocol/sdk`) are mocked per-test using `vi.mock()`.
- **CLI behavior** is tested via subprocess execution (`execFileSync("bun", ...)`) in `index.test.ts`.

## Exit Codes

| Code | Constant               | Meaning                                       |
| ---- | ---------------------- | --------------------------------------------- |
| 0    | `EXIT_SUCCESS`         | Success                                       |
| 1    | `EXIT_APP_ERROR`       | Application error (no results, agent failure) |
| 2    | `EXIT_USAGE_ERROR`     | Invalid arguments or usage                    |
| 3    | `EXIT_AUTH_ERROR`      | Missing or invalid env vars / API keys        |
| 4    | `EXIT_TRANSIENT_ERROR` | Rate limit, timeout, transient failure        |

## Environment Variables

| Variable             | Required | Description                                            |
| -------------------- | -------- | ------------------------------------------------------ |
| `TALENT_PRO_URL`     | No       | Talent Pro app URL (default: `https://pro.talent.app`) |
| `TALENT_CLI_SESSION` | No       | Default session ID                                     |
| `NO_COLOR`           | No       | Disable ANSI color output                              |
