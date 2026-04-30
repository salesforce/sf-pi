/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

// Force a stable timezone for tests that snapshot human-readable timestamps
// (e.g. render-snapshot.test.ts via lib/render.ts::friendlyTime).
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    include: ["extensions/**/tests/**/*.test.ts", "lib/**/tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      // Focus on real source files; skip generated, tests, and fixtures.
      include: ["extensions/**/*.ts", "lib/**/*.ts"],
      exclude: [
        "**/tests/**",
        "**/*.test.ts",
        "**/*.d.ts",
        "catalog/registry.ts",
        "lib/common/test-fixtures.ts",
      ],
      // Pragmatic floor reflecting current baseline. Ratchet up over time.
      // Baseline (2026-04-21): lines 38%, statements 38%, functions 39%, branches 33%.
      thresholds: {
        lines: 35,
        statements: 35,
        functions: 35,
        branches: 30,
      },
      reportsDirectory: "./coverage",
    },
  },
});
