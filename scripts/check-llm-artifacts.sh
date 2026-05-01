#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# scripts/check-llm-artifacts.sh
#
# Fail fast when an LLM-produced commit slips in obvious junk:
#
#   1. Unresolved git merge-conflict markers (<<<<<<<, =======, >>>>>>>).
#   2. Chat/prompt template tokens that occasionally leak out of tool
#      boundaries (<|im_start|>, <|endoftext|>, etc.).
#   3. TODO(llm) / TODO(agent) markers — intentional follow-ups the
#      author forgot to resolve before committing.
#
# Runs against the given file list on stdin (for the pre-commit hook) or
# against every tracked file in the repo (default, used by CI).
#
# Usage:
#   scripts/check-llm-artifacts.sh                     # all tracked files
#   git diff --cached --name-only | scripts/check-llm-artifacts.sh --stdin

set -euo pipefail

SOURCE="${1:-}"

# Resolve file list. Use a tmp file instead of `mapfile` so this works on
# macOS's stock bash 3.2 as well as on GitHub Actions' ubuntu.
tmp_list="$(mktemp)"
trap 'rm -f "$tmp_list"' EXIT
if [ "$SOURCE" = "--stdin" ]; then
  cat > "$tmp_list"
else
  git ls-files > "$tmp_list"
fi

# Skip files this very script references as allowed examples.
# The check-llm-artifacts script, tests, and docs explaining the patterns
# are allowed to mention the strings verbatim; otherwise CI would fail on
# its own detector.
allowlist_regex='^(scripts/check-llm-artifacts\.sh|.*\.test\.(ts|mjs|js)|docs/.*llm.*\.md)$'

# Accumulate findings in a tmp file (portable; no bash-4 arrays).
out="$(mktemp)"
trap 'rm -f "$tmp_list" "$out"' EXIT

while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ ! -f "$f" ] && continue
  # Binary files → skip.
  if file "$f" 2>/dev/null | grep -q "binary"; then
    continue
  fi
  # Allow-listed files (this script, tests, docs about this check).
  if echo "$f" | grep -qE "$allowlist_regex"; then
    continue
  fi

  grep -nE '^(<{7}|={7}|>{7}) ' "$f" 2>/dev/null \
    | sed "s#^#$f: conflict marker: #" >> "$out" || true

  grep -nE '<\|(im_start|im_end|im_sep|system|user|assistant|endoftext|fim_prefix|fim_middle|fim_suffix|tool_call|tool_result)\|>' "$f" 2>/dev/null \
    | sed "s#^#$f: prompt token: #" >> "$out" || true

  grep -nE 'TODO\((llm|agent|claude|gpt|pi)\)' "$f" 2>/dev/null \
    | sed "s#^#$f: open agent marker: #" >> "$out" || true
done < "$tmp_list"

if [ -s "$out" ]; then
  echo "❌ LLM artifact check failed:"
  sed 's/^/  /' "$out"
  echo
  echo "Resolve the markers above and re-run. If a match is a legitimate"
  echo "reference to one of these patterns, add the file to the allow-list"
  echo "regex in scripts/check-llm-artifacts.sh with a brief comment."
  exit 1
fi

echo "✅ No LLM artifacts detected."
