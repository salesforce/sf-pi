/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for local operation timing helpers. */

import { describe, expect, test } from "vitest";
import {
  createTimingCollector,
  renderTimingLine,
  withTimings,
  type TimingSnapshot,
} from "../lib/timings.ts";
import { toolOk } from "../lib/tool-types.ts";

describe("local operation timings", () => {
  test("records total and phase durations", async () => {
    const timings = createTimingCollector();
    await timings.time("local_compile", async () => "ok");
    const auth = timings.phase("agent_api_auth");
    auth.end({ cache: "hit" });

    const snapshot = timings.snapshot();
    expect(snapshot.total_ms).toBeGreaterThanOrEqual(0);
    expect(snapshot.phases.map((p) => p.name)).toEqual(["local_compile", "agent_api_auth"]);
    expect(snapshot.phases[1]).toMatchObject({ cache: "hit" });
  });

  test("attaches timings to tool details and appends an icon timing line", async () => {
    const timings = createTimingCollector();
    await timings.time("server_compile", async () => "ok");

    const result = withTimings(toolOk({ ok: true as const }, "done"), timings, {
      appendLine: true,
    });

    const details = result.details as { timings: TimingSnapshot };
    expect(details.timings.total_ms).toBeGreaterThanOrEqual(0);
    expect(details.timings.phases[0].name).toBe("server_compile");
    expect(result.content[0].text).toContain("⏱️ Timing");
    expect(result.content[0].text).toContain("☁️ server compile");
  });

  test("renders cache state without accepting sensitive values", () => {
    const line = renderTimingLine({
      total_ms: 1234,
      phases: [{ name: "agent_api_auth", ms: 10, cache: "miss" }],
    });

    expect(line).toContain("🔐 agent api auth");
    expect(line).toContain("🟠 cache miss");
    expect(line).not.toMatch(/token|secret|authorization/i);
  });
});
