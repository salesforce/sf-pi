/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-lsp.
 *
 * Verifies the extension module can be imported and exports a default function.
 */
import { describe, it, expect } from "vitest";

describe("sf-lsp", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
