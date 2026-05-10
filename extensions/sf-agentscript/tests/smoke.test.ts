/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-agentscript.
 *
 * Verifies the extension module can be imported and exports a default function.
 */
import { describe, expect, it } from "vitest";

describe("sf-agentscript", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
