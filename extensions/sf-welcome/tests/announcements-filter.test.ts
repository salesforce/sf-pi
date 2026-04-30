/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the pure filter/merge/sort pipeline.
 *
 * These rules are the heart of the feature — a dismissed or expired item
 * should never render. Kept filesystem-free so the whole pipeline can be
 * exercised in milliseconds.
 */
import { describe, expect, it } from "vitest";
import type { AnnouncementItem } from "../../../catalog/types.ts";
import {
  compareAnnouncements,
  filterAnnouncements,
  isExpired,
  matchesVersionRange,
  mergeAnnouncements,
  MAX_VISIBLE_ANNOUNCEMENTS,
} from "../lib/announcements-filter.ts";

function note(id: string, overrides: Partial<AnnouncementItem> = {}): AnnouncementItem {
  return {
    id,
    kind: "note",
    title: `Title ${id}`,
    severity: "info",
    ...overrides,
  };
}

describe("announcements-filter", () => {
  describe("mergeAnnouncements", () => {
    it("merges by id, preferring remote entries", () => {
      const bundled = [note("a", { title: "bundled a" }), note("b")];
      const remote = [note("a", { title: "remote a" }), note("c")];
      const merged = mergeAnnouncements(bundled, remote);
      expect(merged.map((i) => i.id)).toEqual(["a", "b", "c"]);
      const a = merged.find((i) => i.id === "a");
      expect(a?.title).toBe("remote a");
    });
  });

  describe("isExpired", () => {
    it("returns true when expiresAt is past now", () => {
      const now = new Date("2026-05-01T00:00:00Z");
      expect(isExpired(note("a", { expiresAt: "2026-04-30T23:59:59Z" }), now)).toBe(true);
      expect(isExpired(note("a", { expiresAt: "2026-05-01T00:00:01Z" }), now)).toBe(false);
    });

    it("is false when expiresAt is missing or unparseable", () => {
      const now = new Date("2026-05-01T00:00:00Z");
      expect(isExpired(note("a"), now)).toBe(false);
      expect(isExpired(note("a", { expiresAt: "not-a-date" }), now)).toBe(false);
    });
  });

  describe("matchesVersionRange", () => {
    it("hides items below minVersion", () => {
      expect(matchesVersionRange(note("a", { minVersion: "0.17.0" }), "0.16.9")).toBe(false);
      expect(matchesVersionRange(note("a", { minVersion: "0.17.0" }), "0.17.0")).toBe(true);
    });

    it("hides items above maxVersion", () => {
      expect(matchesVersionRange(note("a", { maxVersion: "0.16.0" }), "0.17.0")).toBe(false);
      expect(matchesVersionRange(note("a", { maxVersion: "0.16.0" }), "0.16.0")).toBe(true);
    });

    it("passes when no version hint is installed", () => {
      expect(matchesVersionRange(note("a", { minVersion: "0.17.0" }), undefined)).toBe(true);
    });
  });

  describe("compareAnnouncements", () => {
    it("orders critical ahead of warn ahead of info", () => {
      const items = [
        note("info", { severity: "info", publishedAt: "2026-04-29T00:00:00Z" }),
        note("crit", { severity: "critical", publishedAt: "2026-04-20T00:00:00Z" }),
        note("warn", { severity: "warn", publishedAt: "2026-04-25T00:00:00Z" }),
      ];
      const sorted = [...items].sort(compareAnnouncements);
      expect(sorted.map((i) => i.id)).toEqual(["crit", "warn", "info"]);
    });

    it("within equal severity, prefers newer publishedAt", () => {
      const items = [
        note("old", { publishedAt: "2026-04-20T00:00:00Z" }),
        note("new", { publishedAt: "2026-04-29T00:00:00Z" }),
      ];
      const sorted = [...items].sort(compareAnnouncements);
      expect(sorted.map((i) => i.id)).toEqual(["new", "old"]);
    });
  });

  describe("filterAnnouncements", () => {
    const now = new Date("2026-04-29T12:00:00Z");

    it("drops dismissed ids", () => {
      const result = filterAnnouncements([note("keep"), note("drop")], {
        dismissed: { drop: "2026-04-28T00:00:00Z" },
        now,
      });
      expect(result.map((i) => i.id)).toEqual(["keep"]);
    });

    it("drops expired items", () => {
      const result = filterAnnouncements(
        [note("stale", { expiresAt: "2026-04-01T00:00:00Z" }), note("fresh")],
        { dismissed: {}, now },
      );
      expect(result.map((i) => i.id)).toEqual(["fresh"]);
    });

    it("drops items outside installed version range", () => {
      const result = filterAnnouncements([note("too-new", { minVersion: "0.20.0" }), note("ok")], {
        dismissed: {},
        installedVersion: "0.16.0",
        now,
      });
      expect(result.map((i) => i.id)).toEqual(["ok"]);
    });

    it("caps visible count to MAX_VISIBLE_ANNOUNCEMENTS by default", () => {
      const inputs = Array.from({ length: MAX_VISIBLE_ANNOUNCEMENTS + 3 }, (_, i) =>
        note(`n${i}`, { publishedAt: `2026-04-2${i}T00:00:00Z` }),
      );
      const result = filterAnnouncements(inputs, { dismissed: {}, now });
      expect(result.length).toBe(MAX_VISIBLE_ANNOUNCEMENTS);
    });

    it("respects an explicit maxVisible override", () => {
      const inputs = [note("a"), note("b"), note("c")];
      const result = filterAnnouncements(inputs, { dismissed: {}, now, maxVisible: 1 });
      expect(result.length).toBe(1);
    });
  });
});
