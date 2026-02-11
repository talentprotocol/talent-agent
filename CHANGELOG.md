# Changelog

## 1.1.4

### Patch Changes

- Update install instructions to `npm install -g talent-agent && talent-agent` for immediate feedback, and improve postinstall message visibility on npm v7+.

## 1.1.3

### Patch Changes

- Include postinstall script in published package and add terminal restart hint after Bun installation.

## 1.1.2

### Patch Changes

- Fix npm global install: replace direct TypeScript bin entry with a Node.js wrapper that spawns Bun, and add a postinstall message with getting-started instructions.

## 1.1.1

### Patch Changes

- ### CI
  - Publish to GitHub Packages alongside npm on release, making the package visible on the GitHub repo page.

## 1.1.0

### Minor Changes

- ### Features
  - **Direct detail endpoint** -- `getDetail()` now calls the talent-pro API directly instead of routing through the LLM, significantly reducing latency and token usage.
  - **TUI search history** -- Past chat sessions are loaded from the API on TUI startup, populating the History sidebar with previous conversations.
  - **Localhost callback auth** -- CLI authentication now uses a temporary localhost HTTP server instead of server-side polling, fixing compatibility with Vercel deployments.
  - **TUI slash commands** -- Added `/login` and `/logout` commands for in-TUI authentication management.
  - **New Chat in sidebar** -- Added "New Chat" option to the TUI sidebar with active session tracking for multi-turn conversations.

  ### Improvements
  - Overhauled TUI color scheme with a restrained neutral palette and subtler focus borders.
  - Reduced panel gaps, smaller title bar, and improved welcome screen spacing.

  ### Docs
  - Added ASCII logo and terminal screenshot to README.

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
