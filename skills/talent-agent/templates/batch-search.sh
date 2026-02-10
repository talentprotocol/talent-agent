#!/usr/bin/env bash
# batch-search.sh - Run multiple talent searches and collect results
#
# Usage:
#   chmod +x batch-search.sh
#   ./batch-search.sh
#
# This script demonstrates how to use talent-agent in pipe mode
# to run multiple searches and collect results into a single file.

set -euo pipefail

OUTPUT_DIR="./search-results"
mkdir -p "$OUTPUT_DIR"

# Define searches as an array
SEARCHES=(
  "Find React developers in Berlin"
  "Find senior Python engineers with ML experience"
  "Find full-stack developers who know TypeScript and Go"
  "Find iOS developers in San Francisco"
)

echo "Running ${#SEARCHES[@]} searches..."

# Method 1: Single-shot mode (one process per search)
for i in "${!SEARCHES[@]}"; do
  query="${SEARCHES[$i]}"
  echo "[$((i + 1))/${#SEARCHES[@]}] Searching: $query"
  talent-agent --json "$query" > "$OUTPUT_DIR/search-$i.json" 2>/dev/null
  echo "  -> Saved to $OUTPUT_DIR/search-$i.json"
done

echo ""
echo "--- Method 2: Pipe mode (single process, JSONL) ---"
echo ""

# Method 2: Pipe mode (single process for all searches)
PIPE_INPUT=""
for i in "${!SEARCHES[@]}"; do
  PIPE_INPUT+=$(printf '{"action":"search","id":"req-%d","query":"%s"}\n' "$i" "${SEARCHES[$i]}")
done

echo "$PIPE_INPUT" | talent-agent --pipe > "$OUTPUT_DIR/all-results.jsonl"
echo "All results saved to $OUTPUT_DIR/all-results.jsonl"

# Method 3: Search + Refine workflow
echo ""
echo "--- Method 3: Search + Refine workflow ---"
echo ""

RESULT=$(talent-agent --json "Find React developers")
SESSION=$(echo "$RESULT" | jq -r '.data.session')
echo "Initial search session: $SESSION"

REFINED=$(talent-agent --json --session "$SESSION" "Only show those in Berlin with 5+ years experience")
echo "Refined results:"
echo "$REFINED" | jq '.data.profiles | length' | xargs -I{} echo "  Found {} profiles"

echo ""
echo "Done! Results saved to $OUTPUT_DIR/"
