/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ESLint flat config for sf-pi.
 *
 * Rule posture: pragmatic, not strict.
 * - Runs alongside Prettier (no stylistic rules that fight formatter).
 * - Warns on `any`. Does not fail CI on `any` — yet.
 * - Errors on unused vars/imports/params (underscore-prefix to escape hatch).
 * - CI also runs eslint with --max-warnings=0 so the remaining `warn`
 *   categories cannot accumulate drift silently.
 */
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Ignore generated + third-party output.
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "catalog/registry.ts", // generated
      "**/*.d.ts",
      // Vendored upstream bundle — synced from salesforce/agentscript,
      // never edited by hand.
      "extensions/sf-agentscript-assist/lib/vendor/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },

    rules: {
      // Correctness — unused code is always a bug. Prefix with `_` to mark
      // a parameter or catch binding as intentionally unused.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off", // handled by @typescript-eslint
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-control-regex": "off", // many extensions use ANSI escape matchers intentionally
      "no-useless-assignment": "warn",
      "@typescript-eslint/no-require-imports": "warn",

      // Type hygiene
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        { "ts-expect-error": "allow-with-description", minimumDescriptionLength: 5 },
      ],
    },
  },

  // Tests can use any / non-null without warnings.
  {
    files: ["**/tests/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },

  // Scripts are CLI tools that intentionally log to stdout for operator
  // feedback (scaffold output, catalog summaries, telemetry pings). Allow
  // `console.log` there without carving out each call site.
  {
    files: ["scripts/**/*.{mjs,js,ts}"],
    rules: {
      "no-console": "off",
    },
  },
);
