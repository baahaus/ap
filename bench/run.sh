#!/bin/bash
# Run blush against Terminal-Bench 2.0
# Usage: ./bench/run.sh [options]
# Options are passed through to harbor run

set -euo pipefail
cd "$(dirname "$0")/.."

# Extract OAuth token from macOS keychain (Claude Code subscription)
BLUSH_OAUTH_TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
  | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(d['claudeAiOauth']['accessToken'])" 2>/dev/null || true)

if [ -z "$BLUSH_OAUTH_TOKEN" ]; then
  echo "Error: Could not extract OAuth token from keychain."
  echo "Make sure Claude Code is logged in."
  exit 1
fi

export BLUSH_OAUTH_TOKEN

# Default: run 4 concurrent trials on Terminal-Bench with Sonnet
harbor run \
  -d terminal-bench/terminal-bench-2 \
  -m anthropic/claude-sonnet-4-20250514 \
  --agent-import-path bench.agent:Blush \
  -n 4 \
  "$@"
