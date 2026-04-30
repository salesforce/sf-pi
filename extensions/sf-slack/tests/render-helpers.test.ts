/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the render-helpers exposed via __internals (P1 + P5).
 *
 * We don't exercise the full renderResult path here (it depends on a full
 * pi Theme); these helpers are the non-trivial pieces.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { __internals } from "../lib/render.ts";
import { resetPreferences, setPreferences } from "../lib/preferences.ts";

const {
  shortPermalinkLabel,
  osc8Link,
  clipLine,
  formatPermalink,
  formatChannelLabel,
  friendlyTime,
  authorInitials,
  authorColor,
  hashToBucket,
} = __internals;

// Minimal theme stub compatible with theme.fg(name, text)
const stubTheme = {
  fg: (_name: string, text: string) => text,
} as unknown as import("@mariozechner/pi-coding-agent").Theme;

describe("render helpers", () => {
  beforeEach(() => resetPreferences());

  describe("shortPermalinkLabel", () => {
    it("extracts pNNNNNNNNNN from a standard Slack permalink", () => {
      const url = "https://foo.slack.com/archives/C123/p1776882337856569";
      expect(shortPermalinkLabel(url)).toBe("p1776882337");
    });

    it("falls back to the last path segment when no pNNN is present", () => {
      const url = "https://example.com/path/to/thing";
      expect(shortPermalinkLabel(url)).toBe("thing");
    });

    it("returns the input for malformed URLs", () => {
      expect(shortPermalinkLabel("not a url")).toBe("not a url");
    });
  });

  describe("osc8Link", () => {
    it("wraps the label in OSC 8 hyperlink escape sequences", () => {
      const out = osc8Link("https://x.example", "label");
      expect(out).toContain("\x1b]8;;https://x.example\x1b\\label");
      expect(out.endsWith("\x1b]8;;\x1b\\")).toBe(true);
    });
  });

  describe("clipLine", () => {
    it("returns short lines unchanged", () => {
      expect(clipLine("hello", 10)).toBe("hello");
    });

    it("collapses whitespace", () => {
      expect(clipLine("a  \n  b", 20)).toBe("a b");
    });

    it("clips with an ellipsis when over the limit", () => {
      const out = clipLine("a".repeat(100), 10);
      expect(out.length).toBeLessThanOrEqual(10);
      expect(out.endsWith("…")).toBe(true);
    });
  });

  describe("formatPermalink", () => {
    it("emits an OSC 8 wrapper when compactPermalinks is on (default)", () => {
      const url = "https://foo.slack.com/archives/C123/p1776882337856569";
      const out = formatPermalink(url, stubTheme);
      expect(out).toContain("\x1b]8;;" + url);
      expect(out).toContain("p1776882337");
    });

    it("emits the raw URL when compactPermalinks is off", () => {
      setPreferences({ compactPermalinks: "off" });
      const url = "https://foo.slack.com/archives/C123/p1776882337856569";
      const out = formatPermalink(url, stubTheme);
      expect(out).toBe(url);
    });

    it("returns empty string for a missing permalink", () => {
      expect(formatPermalink(undefined, stubTheme)).toBe("");
    });
  });

  describe("formatChannelLabel", () => {
    it("renders a channel-ID-shaped input via the cache (falls through to ID)", () => {
      // No entries in the channel cache in unit tests, so it should fall
      // through to the raw ID prefixed with '#'.
      expect(formatChannelLabel("C0123456789")).toBe("#C0123456789");
    });

    it("leaves an existing channel name alone", () => {
      expect(formatChannelLabel("project-support")).toBe("#project-support");
    });

    it("strips a redundant leading '#'", () => {
      expect(formatChannelLabel("#general")).toBe("#general");
    });

    it("returns empty string for missing input", () => {
      expect(formatChannelLabel(undefined)).toBe("");
    });
  });

  describe("authorInitials", () => {
    it("returns two-letter initials from first + last word", () => {
      expect(authorInitials("Marcelino Llano")).toBe("ML");
      expect(authorInitials("Setu Shah")).toBe("SS");
    });

    it("splits on dots, dashes, and underscores", () => {
      expect(authorInitials("marcelino.llano")).toBe("ML");
      expect(authorInitials("setu-shah")).toBe("SS");
      expect(authorInitials("setu_shah")).toBe("SS");
    });

    it("strips leading @ if present", () => {
      expect(authorInitials("@marcelino.llano")).toBe("ML");
    });

    it("falls back to first two chars for single-word names", () => {
      expect(authorInitials("bob")).toBe("BO");
    });

    it("defaults to ?? for empty input", () => {
      expect(authorInitials("")).toBe("??");
    });
  });

  describe("authorColor", () => {
    it("returns a stable token for the same input", () => {
      const a = authorColor("Marcelino Llano");
      const b = authorColor("Marcelino Llano");
      expect(a).toBe(b);
    });

    it("is case-insensitive", () => {
      expect(authorColor("Setu Shah")).toBe(authorColor("setu shah"));
    });

    it("returns 'warning' for empty input", () => {
      expect(authorColor("")).toBe("warning");
    });
  });

  describe("hashToBucket", () => {
    it("returns a value inside [0, buckets)", () => {
      for (let index = 0; index < 50; index++) {
        const bucket = hashToBucket(`user-${index}`, 8);
        expect(bucket).toBeGreaterThanOrEqual(0);
        expect(bucket).toBeLessThan(8);
      }
    });

    it("is deterministic", () => {
      expect(hashToBucket("alice", 8)).toBe(hashToBucket("alice", 8));
    });
  });

  describe("friendlyTime", () => {
    it("returns empty string for undefined ts", () => {
      expect(friendlyTime(undefined)).toBe("");
    });

    it("returns raw ts when parsing fails", () => {
      expect(friendlyTime("not-a-number")).toBe("not-a-number");
    });

    it("formats an old Slack ts with a calendar date + time", () => {
      // 2024-03-15T12:00:00Z
      const ts = String(Date.parse("2024-03-15T12:00:00Z") / 1000);
      const out = friendlyTime(ts);
      // Month and day must appear somewhere; exact format varies by locale.
      expect(out).toMatch(/\d{1,2}/);
      expect(out).toContain("·");
    });

    it("includes a clock time for today's messages", () => {
      const nowTs = String(Date.now() / 1000);
      const out = friendlyTime(nowTs);
      expect(out.startsWith("today")).toBe(true);
      expect(out).toContain("·");
    });
  });
});
