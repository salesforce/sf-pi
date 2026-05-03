#!/usr/bin/env bash
set -euo pipefail

# Agent-friendly invariants:
#   1. `CI=1` forces every downstream tool into non-TTY mode. Prettier,
#      eslint, and vitest skip ANSI cursor rewrites (\x1b[K, \x1b[A) that
#      harnesses misread as "no new output." Output becomes plain
#      line-by-line text that flushes through any pipe.
#   2. `FORCE_COLOR=0` keeps color codes out entirely so `tail -N | harness`
#      sees exactly the same bytes as the agent sees.
#   3. A dated progress banner runs before every stage so even a
#      slow-buffering harness never goes more than a couple of seconds
#      without an observable byte on stdout.
#   4. The vitest reporter is pinned to `dot` which prints one character
#      per test and a final summary — tiny output, no cursor movement.
#
# If you need full-fidelity output while iterating locally, just run the
# individual npm scripts directly (npm run check, npm test, etc.).
export CI=1
export FORCE_COLOR=0

banner() {
  # Emit a small, uniquely-prefixed progress marker. Useful for both
  # humans scanning the log and harnesses that watch for "silent for N
  # seconds" — no stage is ever silent for long.
  printf '\n[validate %s] %s\n' "$(date +%H:%M:%S)" "$1"
}

banner "Generate catalog"
node scripts/generate-catalog.mjs

banner "SPDX header check"
node scripts/add-spdx-headers.mjs --check

banner "Docs health check"
node scripts/docs-health.mjs --check

banner "Format check"
npx prettier --check --log-level=warn .

banner "Type check"
npx tsc --noEmit -p tsconfig.json

banner "Tests"
npx vitest run --reporter=dot

banner "All checks passed"
