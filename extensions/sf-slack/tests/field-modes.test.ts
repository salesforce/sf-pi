/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the P2 field-mode trimming in format.ts.
 *
 * These lock in the cheap / medium / full contract so nobody silently doubles
 * Slack tool token cost again.
 */
import { describe, it, expect } from "vitest";
import { formatMessages, formatSearchResults } from "../lib/format.ts";

const longText = "x".repeat(900);

describe("format field modes", () => {
  describe("formatSearchResults", () => {
    const match = {
      channel: { name: "general" },
      username: "alice",
      text: longText,
      ts: "1700000000.000000",
      permalink: "https://slack.com/p/1",
    };

    it("summary mode omits the body line entirely", () => {
      const text = formatSearchResults([match], "summary");
      expect(text).toContain("Channel: #general");
      expect(text).toContain("Author: alice");
      expect(text).toContain("Permalink: https://slack.com/p/1");
      expect(text).not.toContain("Text:");
      expect(text).not.toContain("xxxxxx");
    });

    it("preview mode clips body at ~200 chars with an ellipsis", () => {
      const text = formatSearchResults([match], "preview");
      expect(text).toContain("Text: ");
      // The emitted "Text: ..." line must be shorter than the full body.
      const bodyLine = text.split("\n").find((line) => line.startsWith("Text: "))!;
      expect(bodyLine.length).toBeLessThan(longText.length);
      expect(bodyLine.endsWith("…")).toBe(true);
    });

    it("full mode emits the complete body (back-compat default)", () => {
      const text = formatSearchResults([match]); // default = "full"
      expect(text).toContain(longText);
      expect(text).not.toContain("…");
    });

    it("preview mode keeps short bodies unclipped", () => {
      const short = { ...match, text: "just a line" };
      const text = formatSearchResults([short], "preview");
      expect(text).toContain("Text: just a line");
      expect(text).not.toContain("…");
    });
  });

  describe("formatMessages", () => {
    const message = {
      user: "U1",
      text: longText,
      ts: "1700000000.000000",
      thread_ts: "1700000000.000000",
      reply_count: 3,
    };

    it("summary mode keeps reply_count but drops the body", () => {
      const text = formatMessages([message], undefined, "summary");
      expect(text).toContain("3 replies");
      expect(text).not.toContain("xxxxxx");
    });

    it("preview mode clips the body and still shows reply_count", () => {
      const text = formatMessages([message], undefined, "preview");
      expect(text).toContain("3 replies");
      const line = text.split("\n")[0];
      expect(line.length).toBeLessThan(longText.length);
      expect(line.includes("…")).toBe(true);
    });

    it("empty body renders as (empty) in preview but nothing in summary", () => {
      const blank = { ...message, text: "" };
      expect(formatMessages([blank], undefined, "preview")).toContain("(empty)");
      expect(formatMessages([blank], undefined, "summary")).not.toContain("(empty)");
    });
  });
});
