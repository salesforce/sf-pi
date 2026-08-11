/* SPDX-License-Identifier: Apache-2.0 */
import { defineConfig } from "vitest/config";

// Force a stable timezone for tests that snapshot human-readable timestamps
// (e.g. render-snapshot.test.ts via lib/render.ts::friendlyTime).
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    include: [
      "extensions/**/tests/**/*.test.ts",
      "lib/**/tests/**/*.test.ts",
      "scripts/tests/**/*.test.ts",
    ],
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
      // Full-suite observation (2026-08-10): lines 65.51%, statements 63.46%,
      // functions 69.38%, branches 52.01%. Floors retain roughly three points
      // of headroom so small source additions do not pin CI to one peak run.
      thresholds: {
        lines: 62,
        statements: 60,
        functions: 66,
        branches: 49,
      },
      reportsDirectory: "./coverage",
    },
  },
});
