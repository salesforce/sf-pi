/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ESLint flat config for sf-pi.
 *
 * Rule posture: pragmatic, not strict.
 * - Runs alongside Prettier (no stylistic rules that fight formatter).
 * - Errors on explicit `any` in production code; tests retain a narrow exemption.
 * - Errors on unused vars/imports/params (underscore-prefix to escape hatch).
 * - All enabled project policy rules are errors. CI retains --max-warnings=0
 *   so inherited warning-level drift also fails closed.
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
      "docs/.vitepress/cache/**",
      "docs/.vitepress/dist/**",
      "catalog/registry.ts", // generated
      "**/*.d.ts",
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
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
      "no-control-regex": "off", // many extensions use ANSI escape matchers intentionally
      "no-useless-assignment": "error",
      "@typescript-eslint/no-require-imports": "error",

      // Type hygiene
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
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
