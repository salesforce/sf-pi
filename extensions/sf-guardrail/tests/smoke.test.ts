/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test: the extension exports a default factory that Pi can call.
 */
import { describe, expect, it } from "vitest";

describe("sf-guardrail", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
