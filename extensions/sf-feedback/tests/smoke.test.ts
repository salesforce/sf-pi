/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-feedback.
 *
 * Verifies the extension module can be imported and exports a default function.
 * This is the starting point for TDD — add specific tests as you build features.
 */
import { describe, it, expect } from "vitest";

describe("sf-feedback", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
