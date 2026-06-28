/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TRACE_MINUTES, MAX_TRACE_MINUTES } from "../lib/trace.ts";

describe("trace defaults", () => {
  it("keeps trace windows bounded", () => {
    expect(DEFAULT_TRACE_MINUTES).toBe(30);
    expect(MAX_TRACE_MINUTES).toBe(120);
  });
});
