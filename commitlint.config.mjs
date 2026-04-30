/* SPDX-License-Identifier: Apache-2.0 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Slightly relax the subject length for richer scopes.
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    "header-max-length": [2, "always", 100],
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
