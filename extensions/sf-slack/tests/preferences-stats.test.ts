/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the sf-slack preferences module (P3) and stats module (P4).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_PREFERENCES,
  getPreferences,
  resetPreferences,
  sanitize,
  setPreferences,
} from "../lib/preferences.ts";
import { getStats, recordSample, renderStatsLines, resetStats } from "../lib/stats.ts";

describe("preferences", () => {
  beforeEach(() => resetPreferences());

  it("defaults to auto display profile + widget on + compact permalinks on", () => {
    expect(getPreferences()).toEqual(DEFAULT_PREFERENCES);
    expect(DEFAULT_PREFERENCES.defaultFields).toBe("auto");
  });

  it("applies a partial patch", () => {
    const next = setPreferences({ defaultFields: "summary" });
    expect(next.defaultFields).toBe("summary");
    expect(next.showWidget).toBe("on");
  });

  it("sanitizes unknown stored values back to defaults", () => {
    const cleaned = sanitize({
      defaultFields: "weird" as unknown as "summary",
      showWidget: "maybe" as unknown as "on",
    });
    expect(cleaned.defaultFields).toBe(DEFAULT_PREFERENCES.defaultFields);
    expect(cleaned.showWidget).toBe(DEFAULT_PREFERENCES.showWidget);
    expect(cleaned.compactPermalinks).toBe(DEFAULT_PREFERENCES.compactPermalinks);
  });
});

describe("stats", () => {
  beforeEach(() => resetStats());

  const noopTheme = {
    dim: (s: string) => s,
    muted: (s: string) => s,
    accent: (s: string) => s,
  };

  it("starts empty and renders nothing", () => {
    expect(getStats().searches).toBe(0);
    expect(renderStatsLines(noopTheme)).toEqual([]);
  });

  it("increments per-action counters and totals", () => {
    recordSample({ action: "search", messageCount: 20, bytes: 4096 });
    recordSample({ action: "thread", messageCount: 29, bytes: 8192 });
    const snap = getStats();
    expect(snap.searches).toBe(1);
    expect(snap.threads).toBe(1);
    expect(snap.messagesFetched).toBe(49);
    expect(snap.totalBytes).toBe(12288);
  });

  it("renders a single summary line once activity exists", () => {
    recordSample({ action: "search", messageCount: 5, bytes: 1024 });
    const lines = renderStatsLines(noopTheme);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("1 search");
    expect(lines[0]).toContain("5 msgs");
    expect(lines[0]).toContain("1.0KB fetched");
  });
});
