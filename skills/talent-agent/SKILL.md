---
name: talent-agent
description: Search for talent profiles using natural language via the Talent CLI tool
---

# Talent CLI Skill

## Overview

`talent-agent` is a command-line tool that searches talent profiles using natural language queries. It wraps an AI agent connected to OpenSearch.

## Core Workflow

1. **Search**: Send a natural language query to find matching profiles.
2. **Refine**: Use the session ID to add filters or narrow results.
3. **Detail**: Request full profile details by index from the last search.

## Modes of Operation

### Single-Shot (CLI flags)

```bash
# Basic search
talent-agent "Find React developers in Lisbon"

# JSON output
talent-agent --json "Find senior Python engineers"

# Refine previous search
talent-agent --session <id> "Only show those with 5+ years"

# Get profile detail
talent-agent --session <id> --detail 0
```

### Pipe Mode (JSONL)

Send JSON objects to stdin, receive JSON envelopes on stdout:

```bash
echo '{"action":"search","query":"Find Rust developers","id":"req-1"}' | talent-agent --pipe
```

Input schema (new format):

```json
{"action": "search", "id": "req-1", "query": "Find React devs", "session": "optional-id"}
{"action": "detail", "id": "req-2", "session": "abc123", "index": 0}
```

Legacy input format (still supported):

```json
{"query": "Find React devs"}
{"detail": 0, "session": "abc123"}
```

### MCP Server

```bash
talent-agent --serve
```

Exposes three tools: `talent_search`, `talent_detail`, `talent_refine`.

### Programmatic API

```typescript
import { TalentSearch } from "talent-agent";

const ts = new TalentSearch();
const { result, meta } = await ts.search("Find React developers in Lisbon");
console.log(result.profiles);

// Refine
const refined = await ts.refine(result.session, "Only seniors");

// Detail
const detail = await ts.detail(result.session, 0);
```

## Common Patterns

### Session Refinement

```bash
# Initial search -> get session ID
RESULT=$(talent-agent --json "Find Python developers")
SESSION=$(echo "$RESULT" | jq -r '.data.session')

# Refine with the session
talent-agent --json --session "$SESSION" "Only show those in Lisbon"
```

### Debug Mode

Add `--debug` (or `-D`) to see agent internals on stderr:

```bash
talent-agent --debug --json "Find React devs" 2>debug.log
```

### Environment Variable Session

```bash
export TALENT_CLI_SESSION=abc123
talent-agent "Only show seniors"  # Uses abc123 session automatically
```

## Response Envelope

All JSON and pipe output uses a standard envelope:

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
  "error": "Service unreachable. Check TALENT_PRO_URL.",
  "code": "CONNECTION_ERROR"
}
```

## Error Codes

| Code               | Meaning                     |
| ------------------ | --------------------------- |
| CONNECTION_ERROR   | Service unreachable         |
| AUTH_ERROR         | Invalid API key             |
| RATE_LIMIT         | Rate limit exceeded         |
| CONTEXT_OVERFLOW   | Session too long            |
| VALIDATION_ERROR   | Invalid input               |
| SESSION_NOT_FOUND  | Session does not exist      |
| INDEX_OUT_OF_RANGE | Profile index out of bounds |
| UNKNOWN_ERROR      | Unclassified error          |
