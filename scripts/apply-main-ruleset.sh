#!/usr/bin/env bash
# scripts/apply-main-ruleset.sh
#
# Apply the `main protection` branch Ruleset for salesforce/sf-pi.
#
# Uses GitHub's newer Rulesets API (the successor to classic branch
# protection). Rulesets support bypass lists, so repo Admins can keep
# pushing directly to main while external contributors go through the
# PR + review flow.
#
# Baseline (matches what salesforce/agentscript runs today, plus a
# linear-history requirement and squash-only merges):
#
#   - Block deletion of main
#   - Block non-fast-forward (force) pushes
#   - Require linear history (no merge commits)
#   - Require PR before merging, 1 approving review, CODEOWNERS review,
#     squash-only merge method
#   - Required status checks (strict=false so rebases aren't forced):
#       Validate, npm audit (production), gitleaks
#     CodeQL is NOT required here because its workflow is schedule-only
#     (weekly) plus workflow_dispatch — requiring it would stall every PR.
#   - Bypass: repo Admins only (actor_id 5). The release-please auto-merge
#     job can't bypass the PR rule, so release PRs now require a single
#     manual merge click from an Admin. Same pattern salesforce/agentscript
#     uses.
#
# Usage:
#   gh auth login                              # must be SSO-approved for salesforce
#   bash scripts/apply-main-ruleset.sh
#
# Requires Admin on the repo. Idempotent — re-running updates the existing
# ruleset in place (looked up by name).

set -euo pipefail

REPO="salesforce/sf-pi"
RULESET_NAME="main protection"

echo "==> Applying ruleset '${RULESET_NAME}' to ${REPO}..."

payload=$(cat <<JSON
{
  "name": "${RULESET_NAME}",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "Validate" },
          { "context": "npm audit (production)" },
          { "context": "gitleaks" }
        ]
      }
    }
  ]
}
JSON
)

# Look up an existing ruleset of the same name (idempotent update).
existing_id=$(gh api "repos/${REPO}/rulesets" --jq \
  ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null | head -1 || true)

if [ -n "${existing_id}" ]; then
  echo "==> Found existing ruleset id=${existing_id}; updating in place."
  echo "${payload}" | gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/${REPO}/rulesets/${existing_id}" \
    --input -
else
  echo "==> No existing ruleset; creating."
  echo "${payload}" | gh api \
    --method POST \
    -H "Accept: application/vnd.github+json" \
    "repos/${REPO}/rulesets" \
    --input -
fi

# Also flip repo-level merge settings to match:
#   - squash-only
#   - auto-delete head branch after merge
#   - allow auto-merge (release-please needs it)
echo
echo "==> Locking repo merge settings to squash-only with branch auto-delete."
gh api \
  --method PATCH \
  -H "Accept: application/vnd.github+json" \
  "repos/${REPO}" \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -F allow_squash_merge=true \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  --silent

echo
echo "==> Verifying final state:"
gh api "repos/${REPO}/rules/branches/main" --jq \
  '{rules: [.[] | {type, params: .parameters}]}'

echo
gh api "repos/${REPO}" --jq \
  '{allow_squash_merge, allow_merge_commit, allow_rebase_merge, delete_branch_on_merge, allow_auto_merge}'

echo
echo "==> Done."
