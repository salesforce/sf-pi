/* SPDX-License-Identifier: Apache-2.0 */
/**
 * lint-staged configuration.
 *
 * For `*.{ts,mjs,js}` we run, in order:
 *   1. add-spdx-headers on the staged files (auto-add missing headers)
 *   2. prettier --write
 *   3. eslint --fix
 *   4. npm run generate-catalog (catalog stays in sync with source edits)
 *   5. git add the generated catalog/doc outputs
 *
 * Why SPDX runs first: CI's Validate job runs `spdx:check` which fails
 * the whole pipeline on any missing header. Catching it at pre-commit is
 * much cheaper than a red CI run + fix commit + release PR rebase.
 * Running the auto-add variant (not --check) means the developer doesn't
 * have to fix it by hand — lint-staged re-stages modified files
 * automatically, so the header lands in the same commit.
 *
 * Why the regeneration step is here: `eslint --fix` can add or remove
 * lines (trailing commas, blank lines, import reordering) and our catalog
 * script counts non-empty lines into `catalog/index.json`'s `srcLoc`
 * field. If we regenerated the catalog *before* committing but *before*
 * eslint reformatted the source, the `srcLoc` numbers drift and CI's
 * `npm run generate-catalog:check` fails on the next push. Running the
 * regenerator AFTER eslint — inside the same commit — keeps local and CI
 * in lock-step.
 *
 * Manifest-only edits (e.g. a `description` change with no `.ts` churn)
 * are rare; CI's generate-catalog:check still guards them. Keeping the
 * hook scoped to `.ts`/`.mjs`/`.js` avoids racing parallel `git add`
 * invocations across multiple lint-staged patterns.
 *
 * The generator is cheap (~200 ms) and idempotent, so running it once
 * per commit is fine. The final `git add` line lists every file the
 * generator can touch; unchanged entries are no-ops for git.
 */

const GENERATED_PATHS = [
  "catalog/index.json",
  "catalog/registry.ts",
  "catalog/announcements.json",
  "catalog/recommendations.json",
  "README.md",
  "ARCHITECTURE.md",
  "docs/commands.md",
];

export default {
  "*.{ts,mjs,js}": (files) => [
    // Auto-add SPDX headers to any staged .ts/.mjs that lacks one. The
    // script is idempotent and scoped to the given paths, so files that
    // already have the header are no-ops. .js is skipped by the script's
    // internal EXTS set, which matches our repo convention.
    `node scripts/add-spdx-headers.mjs ${files.join(" ")}`,
    `prettier --write ${files.join(" ")}`,
    `eslint --fix ${files.join(" ")}`,
    "npm run generate-catalog --silent",
    `git add ${GENERATED_PATHS.join(" ")}`,
  ],
  "*.{json,md,yml,yaml}": (files) => [`prettier --write ${files.join(" ")}`],
};
