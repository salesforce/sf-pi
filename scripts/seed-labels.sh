#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Seed the canonical GitHub labels for sf-pi. Idempotent — existing labels
# are updated to match the definition below; missing labels are created.
#
# Usage:
#   ./scripts/seed-labels.sh
#
# Requires: gh CLI, authenticated against this repo.

set -euo pipefail

REPO="${GITHUB_REPO:-salesforce/sf-pi}"

label() {
  local name="$1"
  local color="$2"
  local desc="$3"

  if gh label list --repo "$REPO" --limit 500 --json name --jq '.[].name' | grep -Fxq "$name"; then
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$desc" >/dev/null
    echo "updated: $name"
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$desc" --force >/dev/null
    echo "created: $name"
  fi
}

# --- Type ---
label "bug"                "d73a4a" "Something isn't working"
label "enhancement"        "a2eeef" "New feature or request"
label "docs"               "0075ca" "Improvements or additions to documentation"
label "security"           "ee0701" "Security-related issue or fix"
label "performance"        "7057ff" "Performance improvement"
label "refactor"           "cfd3d7" "Code refactoring, no behavior change"
label "test"               "bfdadc" "Testing-only change"
label "ci"                 "ededed" "Continuous integration and build"
label "chore"              "fef2c0" "Maintenance, cleanups, non-user-facing"
label "dependencies"       "0366d6" "Pull requests that update a dependency"

# --- Status ---
label "triage"             "fbca04" "Needs triage — not yet reviewed"
label "in-progress"        "0e8a16" "Actively being worked on"
label "blocked"            "b60205" "Blocked on another change or external dependency"
label "stale"              "c2e0c6" "No activity for the stale threshold"
label "wontfix"            "ffffff" "This will not be worked on"
label "duplicate"          "cfd3d7" "Duplicate of another issue or PR"

# --- Contribution ---
label "good first issue"   "7057ff" "Good for newcomers"
label "help wanted"        "008672" "Extra attention is needed"
label "discussion"         "d4c5f9" "Open design / discussion question"

# --- Scope (per-extension) ---
label "scope:sf-pi-manager"          "c5def5" "Core manager extension"
label "scope:sf-lsp"                 "c5def5" "SF LSP extension"
label "scope:sf-slack"               "c5def5" "SF Slack extension"
label "scope:sf-devbar"              "c5def5" "SF DevBar extension"
label "scope:sf-welcome"             "c5def5" "SF Welcome splash extension"
label "scope:sf-ohana-spinner"       "c5def5" "SF Ohana Spinner extension"
label "scope:sf-skills-hud"          "c5def5" "SF Skills HUD extension"
label "scope:sf-llm-gateway-internal" "c5def5" "SF LLM Gateway Internal extension"

echo "done"
