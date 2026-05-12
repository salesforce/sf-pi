/* SPDX-License-Identifier: Apache-2.0 */
export default {
  extends: ["@commitlint/config-conventional"],
  // Skip lint on Dependabot grouped-update PRs. The auto-generated body
  // contains long URLs (compare links, signed-off-by trailer) that exceed
  // body-max-line-length but are not under our control. The squash-merge
  // commit subject is still linted via the PR title check.
  ignores: [(msg) => /^Signed-off-by: dependabot\[bot\]/m.test(msg)],
  rules: {
    // Slightly relax the subject length for richer scopes.
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    "header-max-length": [2, "always", 100],
    // Long URLs in commit bodies are common (Dependabot, links to ADRs).
    // Warn so they're visible in CI but don't block merges.
    "body-max-line-length": [1, "always", 100],
    // Allowed types — conventional-commits + a few custom.
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
        "security",
      ],
    ],
  },
};
