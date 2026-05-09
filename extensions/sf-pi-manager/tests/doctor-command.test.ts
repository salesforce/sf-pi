/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the per-extension doctor aggregation rendering inside
 * `/sf-pi doctor`. Pins the shape so future ADR-0006 follow-ups don't
 * accidentally drift the user-visible block.
 */
import { describe, expect, it } from "vitest";
import { renderExtensionOutcomes } from "../lib/doctor-command.ts";
import type { RegisteredDoctorOutcome } from "../../../lib/common/doctor/registry.ts";

const SAMPLE_OUTCOMES: RegisteredDoctorOutcome[] = [
  {
    extensionId: "sf-alpha",
    status: "ok",
    durationMs: 12,
    report: {
      extensionId: "sf-alpha",
      title: "SF Alpha",
      summary: "✓ ok",
      durationMs: 12,
      checks: [
        {
          id: "alpha.basic",
          severity: "ok",
          title: "Alpha basic check",
          detail: "All good",
        },
        {
          id: "alpha.warn",
          severity: "warn",
          title: "Alpha needs attention",
          detail: "Token rotated less than 24h ago",
          fix: "Run /alpha refresh",
        },
      ],
    },
  },
  {
    extensionId: "sf-bad",
    status: "error",
    durationMs: 4,
    error: "kaboom",
  },
  {
    extensionId: "sf-slow",
    status: "timeout",
    durationMs: 5_001,
  },
];

describe("renderExtensionOutcomes", () => {
  it("renders OK outcomes with their per-check rows and summaries", () => {
    const text = renderExtensionOutcomes([SAMPLE_OUTCOMES[0]!]);
    expect(text).toContain("Extension diagnostics:");
    expect(text).toContain("SF Alpha");
    expect(text).toContain("✓ Alpha basic check");
    expect(text).toContain("! Alpha needs attention");
    expect(text).toContain("Fix: Run /alpha refresh");
  });

  it("surfaces error outcomes inline without blocking the rest of the report", () => {
    const text = renderExtensionOutcomes(SAMPLE_OUTCOMES);
    expect(text).toContain("sf-bad — errored: kaboom");
    expect(text).toContain("sf-slow — timed out after 5001ms");
    // OK outcomes still appear alongside failures.
    expect(text).toContain("SF Alpha");
  });

  it("returns just the heading when given an empty list", () => {
    const text = renderExtensionOutcomes([]);
    expect(text).toBe("Extension diagnostics:");
  });
});
