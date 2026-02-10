# Changelog

## 1.0.0

### Features

- Single-shot, pipe, interactive TUI, and MCP server modes
- AI-powered talent profile search with session refinement
- Authentication support (email, Google, wallet)
- Zod-validated JSONL pipe protocol with request ID correlation
- Success/error response envelope for JSON output
- Programmatic TypeScript API (`TalentSearch` class)
- Session persistence (save/load to JSON files)
- `--debug` flag for agent diagnostics (to stderr)
- `--help --json` for agent self-discovery
- `TALENT_CLI_SESSION` environment variable
- `NO_COLOR` support
- AI-friendly error rewriting with structured exit codes
- MCP server with `talent_search`, `talent_detail`, `talent_refine` tools

### Infrastructure

- Prettier + Husky + lint-staged
- Vitest test suite
- GitHub Actions CI (typecheck, format, test)
- Changesets for versioning
- Docker support (Dockerfile + docker-compose)
