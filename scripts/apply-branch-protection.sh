#!/usr/bin/env bash
# scripts/apply-branch-protection.sh
#
# Apply the baseline branch-protection rules for salesforce/sf-pi:main.
# Requires Admin on the repo. Run once after the initial public release.
#
# Rules applied:
#   - Require PR before merging
#   - Require 1 approving review
#   - Require CODEOWNERS review
#   - Dismiss stale approvals on new commits
#   - Require status checks: ci, codeql, gitleaks
#   - Require strict (up-to-date) status checks
#   - Require linear history (no merge commits)
#   - Require conversation resolution
#   - Block force-push and deletion
#   - Do NOT enforce for admins (allows emergency hotfix; flip to true for stricter policy)
#
# Usage:
#   gh auth login  # must be SSO-authorized for salesforce org
#   bash scripts/apply-branch-protection.sh

set -euo pipefail

REPO="salesforce/sf-pi"
BRANCH="main"

echo "==> Applying branch protection to $REPO:$BRANCH ..."

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  "/repos/$REPO/branches/$BRANCH/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci", "CodeQL", "gitleaks"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

echo "==> Done. Verify:"
gh api "/repos/$REPO/branches/$BRANCH/protection" \
  --jq '{pr: .required_pull_request_reviews, checks: .required_status_checks, linear: .required_linear_history.enabled, force: .allow_force_pushes.enabled, deletions: .allow_deletions.enabled}'
