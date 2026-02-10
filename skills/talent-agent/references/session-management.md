# Session Management

## Overview

Sessions in talent-agent maintain conversation history between the user and the AI agent. This enables multi-turn interactions like refining search results, asking follow-up questions, and getting profile details.

## How Sessions Work

1. Every `query()` call creates or reuses a session.
2. Sessions store the full message history (`user` + `assistant` messages).
3. The session ID is returned in every response.
4. Pass the session ID back to continue the conversation.

## Session Lifecycle

```
[New Query] -> Session created (nanoid) -> [Response with session ID]
     |
     v
[Refine with session ID] -> Messages appended -> [Refined response]
     |
     v
[Detail with session ID] -> Agent fetches full profile -> [Detail response]
```

## Refinement Patterns

### Narrowing Results

```bash
# Initial broad search
talent-agent --json "Find developers"
# Response: session = "abc123", 150 matches

# Narrow by technology
talent-agent --json --session abc123 "Only React developers"
# Response: 42 matches

# Narrow further by location
talent-agent --json --session abc123 "In Berlin only"
# Response: 8 matches
```

### Changing Criteria

```bash
# Switch from technology to seniority filter
talent-agent --json --session abc123 "Show only seniors with 5+ years"
```

## Session Persistence

Sessions can be saved to and loaded from JSON files:

```bash
# Save a session
talent-agent session save abc123 ./my-search.json

# Load a session (restores messages and last result)
talent-agent session load ./my-search.json

# Continue the loaded session
talent-agent --session abc123 "Show more details"
```

### Serialized Session Format

```json
{
  "id": "abc123",
  "messages": [
    {"role": "user", "content": "Find React developers in Berlin"},
    {"role": "assistant", "content": "Found 42 matching profiles..."}
  ],
  "lastResult": {
    "type": "search",
    "session": "abc123",
    "profiles": [...],
    "totalMatches": 42,
    "summary": "...",
    "appliedFilters": {}
  }
}
```

## Environment Variable

Set `TALENT_CLI_SESSION` to automatically use a session without passing `--session`:

```bash
export TALENT_CLI_SESSION=abc123
talent-agent "Only show seniors"  # Uses abc123 session
```

The `--session` flag takes precedence over the environment variable.

## In-Memory Storage

Sessions are stored in-memory using a `Map<string, Session>`. This means:

- Sessions persist for the lifetime of the process
- In single-shot mode, a new process = a new session store (use `--session` to continue)
- In TUI mode, all sessions created during the current process are available
- In pipe mode, sessions accumulate across all JSONL requests
- In MCP server mode, sessions persist across tool calls

## API Usage

```typescript
import { TalentSearch } from "talent-agent";

const ts = new TalentSearch();

// Search creates a session
const { result } = await ts.search("Find React developers");
const sessionId = result.session;

// Refine reuses the session
const refined = await ts.refine(sessionId, "Only seniors");

// Detail also reuses the session
const detail = await ts.detail(sessionId, 0);
```
