/* SPDX-License-Identifier: Apache-2.0 */
/** Smoke test for sf-herdr. */
import { describe, expect, it } from "vitest";

describe("sf-herdr", () => {
  it("exports a default extension factory", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
