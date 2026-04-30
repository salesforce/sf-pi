/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for deterministic Slack time-range normalization. */
import { describe, expect, it } from "vitest";
import { resolveSlackTimeRange } from "../lib/time-range.ts";

describe("slack time range helpers", () => {
  it("resolves previous calendar week in UTC", () => {
    const result = resolveSlackTimeRange({
      expression: "last week",
      timezone: "UTC",
      anchor: "2026-04-25T15:30:00Z",
    });

    expect(result.range.start_iso).toBe("2026-04-13T00:00:00+00:00");
    expect(result.range.end_iso).toBe("2026-04-20T00:00:00+00:00");
    expect(result.slack.history.oldest).toBe("1776038400.000000");
    expect(result.slack.history.latest).toBe("1776643200.000000");
    expect(result.slack.search.query_suffix).toBe("after:2026-04-13 before:2026-04-20");
  });

  it("resolves calendar week boundaries in the requested timezone", () => {
    const result = resolveSlackTimeRange({
      expression: "last week",
      timezone: "America/Los_Angeles",
      anchor: "2026-04-25T15:30:00Z",
    });

    expect(result.range.start_iso).toBe("2026-04-13T00:00:00-07:00");
    expect(result.range.end_iso).toBe("2026-04-20T00:00:00-07:00");
    expect(result.slack.history.oldest).toBe("1776063600.000000");
    expect(result.slack.history.latest).toBe("1776668400.000000");
    expect(result.slack.search.query_suffix).toBe("after:2026-04-13 before:2026-04-20");
  });

  it("resolves yesterday as a local calendar day", () => {
    const result = resolveSlackTimeRange({
      expression: "yesterday",
      timezone: "UTC",
      anchor: "2026-04-25T10:00:00Z",
    });

    expect(result.range.start_iso).toBe("2026-04-24T00:00:00+00:00");
    expect(result.range.end_iso).toBe("2026-04-25T00:00:00+00:00");
    expect(result.slack.search.query_suffix).toBe("after:2026-04-24 before:2026-04-25");
  });

  it("supports explicit exclusive and inclusive date ranges", () => {
    const exclusive = resolveSlackTimeRange({
      expression: "2026-04-13 to 2026-04-20",
      timezone: "UTC",
    });
    const inclusive = resolveSlackTimeRange({
      expression: "2026-04-13 through 2026-04-20",
      timezone: "UTC",
    });

    expect(exclusive.range.end_iso).toBe("2026-04-20T00:00:00+00:00");
    expect(exclusive.slack.search.query_suffix).toBe("after:2026-04-13 before:2026-04-20");
    expect(inclusive.range.end_iso).toBe("2026-04-21T00:00:00+00:00");
    expect(inclusive.slack.search.query_suffix).toBe("after:2026-04-13 before:2026-04-21");
  });

  it("rejects invalid calendar dates", () => {
    expect(() => resolveSlackTimeRange({ expression: "2026-13-40", timezone: "UTC" })).toThrow(
      /Unsupported Slack time expression/,
    );
  });

  it("resolves rolling ranges with exact oldest/latest timestamps", () => {
    const result = resolveSlackTimeRange({
      expression: "last 7 days",
      timezone: "UTC",
      anchor: "2026-04-25T15:30:00Z",
    });

    expect(result.range.start_iso).toBe("2026-04-18T15:30:00+00:00");
    expect(result.range.end_iso).toBe("2026-04-25T15:30:00+00:00");
    expect(result.slack.history.oldest).toBe("1776526200.000000");
    expect(result.slack.history.latest).toBe("1777131000.000000");
    expect(result.slack.search.query_suffix).toBe("after:2026-04-18 before:2026-04-26");
    expect(result.notes.join("\n")).toContain("day-granular");
  });
});
