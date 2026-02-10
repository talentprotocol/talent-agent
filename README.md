# talent-agent

AI-powered talent profile search using natural language. CLI tool with interactive TUI, JSON output, pipe mode, and MCP server.

## Installation

### Prerequisites

- [Bun](https://bun.sh/) v1.3+

### Setup

```bash
git clone <repo-url> talent-agent
cd talent-agent
bun install
```

### Authentication

```bash
talent-agent login              # Interactive (choose method)
talent-agent login --email      # Email magic code
talent-agent login --google     # Google OAuth
talent-agent login --wallet     # Wallet (SIWE)
talent-agent whoami             # Check auth status
talent-agent logout             # Clear credentials
```

## Quick Start

```bash
# Search for profiles
talent-agent "Find React developers in Berlin"

# JSON output (auto-enabled when piping stdout)
talent-agent --json "Find senior Python engineers"

# Refine a previous search
talent-agent --session abc123 "Only show those with 5+ years"

# Get detailed profile by index
talent-agent --session abc123 --detail 0

# Interactive TUI (default when no query)
talent-agent

# Pipe mode (JSONL in, JSONL out)
echo '{"action":"search","query":"Find Rust devs"}' | talent-agent --pipe

# MCP server mode
talent-agent --serve
```

## Modes

### Single-Shot

Run a query, get results, exit. Pass `--json` for machine-readable output wrapped in a success/error envelope.

```bash
talent-agent "Find full-stack engineers in London"
talent-agent --json "Find ML engineers" | jq '.data.profiles[].displayName'
```

### Interactive TUI

A two-column terminal UI with search history on the left and results on the right.

```
Tab          Switch focus between sidebar and search input
Up/Down      Navigate search history or results
Enter        Submit search / select history item
d + number   Show detail for profile at that index
n            Next page of results
q / Ctrl+C   Quit
```

### Pipe Mode

Read JSONL from stdin, write JSONL to stdout. Designed for agent-to-agent communication.

```bash
# New format (Zod-validated)
echo '{"action":"search","id":"req-1","query":"Find React devs"}' | talent-agent --pipe
echo '{"action":"detail","id":"req-2","session":"abc","index":0}' | talent-agent --pipe

# Legacy format (still supported)
echo '{"query":"Find React devs"}' | talent-agent --pipe
```

Each response is a JSON envelope with request ID correlation:

```json
{"success":true,"data":{...},"meta":{"durationMs":3200,"tokensUsed":1847,"toolsCalled":["searchProfiles"]},"id":"req-1"}
```

### MCP Server

Expose talent-agent as a [Model Context Protocol](https://modelcontextprotocol.io/) server over stdio, making it natively usable by Claude, Cursor, Gemini CLI, GitHub Copilot, and other MCP-compatible clients.

```bash
talent-agent --serve
```

Tools exposed: `talent_search`, `talent_detail`, `talent_refine`.

## Options

| Flag | Short | Description |
| ---- | ----- | ----------- |
| `--help` | `-h` | Show help message |
| `--version` | `-v` | Show version number |
| `--json` | `-j` | Output results as JSON envelope |
| `--session <id>` | `-s` | Continue a previous search session |
| `--detail <index>` | `-d` | Show detailed profile at index from last search |
| `--pipe` | `-p` | JSONL mode: read from stdin, write to stdout |
| `--debug` | `-D` | Print agent diagnostics to stderr |
| `--serve` | | Start as MCP server (stdio transport) |

Combine `--help` and `--json` to get a structured capabilities schema for agent self-discovery:

```bash
talent-agent --help --json
```

## Sessions

Sessions maintain conversation history for multi-turn refinement.

```bash
# Initial search
RESULT=$(talent-agent --json "Find Python developers")
SESSION=$(echo "$RESULT" | jq -r '.data.session')

# Refine
talent-agent --json --session "$SESSION" "Only show those in Berlin"

# Detail
talent-agent --json --session "$SESSION" --detail 0
```

## Agent Mode

### JSON Envelope

All `--json` and `--pipe` output uses a standardized envelope:

**Success:**

```json
{
  "success": true,
  "data": {"type": "search", "session": "abc", "profiles": [...]},
  "meta": {"durationMs": 3200, "tokensUsed": 1847, "toolsCalled": ["searchProfiles"]}
}
```

**Error:**

```json
{
  "success": false,
  "error": "Rate limit hit. Wait 60s and retry, or use a different API key.",
  "code": "RATE_LIMIT"
}
```

### Debug Mode

Add `--debug` to see agent internals on stderr (does not pollute JSON on stdout):

```bash
talent-agent --debug --json "Find React devs" 2>debug.log
```

```
[debug] Agent calling: searchProfiles
[debug] Tool input: {"languages":["React"],"location":"Berlin"}
[debug] Tool response: 142ms, 23 profiles
[debug] Agent total: 1,847 tokens, 3.2s
```

### Structured Exit Codes

| Code | Meaning |
| ---- | ------- |
| 0 | Success |
| 1 | Application error (no results, agent failure) |
| 2 | Invalid arguments or usage |
| 3 | Missing or invalid API keys |
| 4 | Rate limit, timeout, transient failure |

### Error Codes

| Code | Meaning |
| ---- | ------- |
| `CONNECTION_ERROR` | Service unreachable |
| `AUTH_ERROR` | Invalid API key |
| `RATE_LIMIT` | Rate limit exceeded |
| `CONTEXT_OVERFLOW` | Session too long |
| `VALIDATION_ERROR` | Invalid input |
| `SESSION_NOT_FOUND` | Session does not exist |
| `INDEX_OUT_OF_RANGE` | Profile index out of bounds |
| `UNKNOWN_ERROR` | Unclassified error |

## Programmatic API

Import `talent-agent` as a library in your TypeScript/JavaScript project:

```typescript
import { TalentSearch } from "talent-agent";

const ts = new TalentSearch();

// Search
const { result, meta } = await ts.search("Find React developers in Berlin");
console.log(result.profiles);

// Refine
const refined = await ts.refine(result.session, "Only seniors");

// Detail
const detail = await ts.detail(result.session, 0);
```

## MCP Server Integration

### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "talent-agent": {
      "command": "bun",
      "args": ["run", "/path/to/talent-agent/src/index.ts", "--serve"]
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "talent-agent": {
      "command": "bun",
      "args": ["run", "/path/to/talent-agent/src/index.ts", "--serve"]
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `TALENT_PRO_URL` | No | Talent Pro app URL (default: `https://pro.talent.app`) |
| `TALENT_CLI_SESSION` | No | Default session ID |
| `NO_COLOR` | No | Disable ANSI color output |

## Development

```bash
bun run start                    # Run the CLI
bun run start -- "Find devs"    # Single-shot
bun run dev                      # Watch mode
bun run test                     # Run tests
bun run test:watch               # Run tests in watch mode
bun run typecheck                # Type checking
bun run format                   # Format code
bun run format:check             # Check formatting
```

### Changeset Workflow

```bash
bun run changeset               # Create a changeset
bun run version:packages        # Apply changesets to bump versions
```

### Docker

```bash
bun run docker:build            # Build container image
bun run docker:serve            # Start MCP server in Docker
```

## Architecture

```
src/
  index.ts              CLI entry point, argument parser, mode router
  agent.ts              Agent wrapper: sessions, query(), getDetail()
  errors.ts             AI-friendly error rewriting + structured exit codes
  format.ts             Terminal formatters (ANSI) for human-readable output
  env.ts                Environment variable loading and validation
  lib.ts                Programmatic TS/JS API (TalentSearch class)
  auth/                 Authentication (email, Google, wallet)
  programmatic/
    single-shot.ts      Single-shot mode
    piped.ts            Pipe mode (JSONL)
  tui/
    app.ts              TUI layout and keyboard handling
    results.ts          Results panel
    sidebar.ts          Search history sidebar
  mcp/
    server.ts           MCP server (talent_search, talent_detail, talent_refine)
```

## License

Apache-2.0
