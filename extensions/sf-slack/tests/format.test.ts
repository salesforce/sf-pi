/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack format module.
 *
 * Pure formatter tests — no network calls, no Pi dependencies.
 */
import { describe, it, expect } from "vitest";
import {
  formatSearchResults,
  formatMessages,
  extractStructuredMatches,
  extractStructuredMessages,
} from "../lib/format.ts";

describe("format", () => {
  describe("formatSearchResults", () => {
    it("returns empty message for no matches", () => {
      expect(formatSearchResults([])).toBe("No Slack messages matched the query.");
    });

    it("formats a single match", () => {
      const matches = [
        {
          channel: { name: "general" },
          username: "alice",
          text: "Hello world",
          ts: "1700000000.000000",
          permalink: "https://slack.com/archives/C123/p1700000000",
        },
      ];
      const result = formatSearchResults(matches);
      expect(result).toContain("Result 1");
      expect(result).toContain("#general");
      expect(result).toContain("alice");
      expect(result).toContain("Hello world");
      expect(result).toContain("https://slack.com/archives/C123/p1700000000");
    });

    it("formats multiple matches", () => {
      const matches = [
        { channel: { name: "a" }, username: "u1", text: "first", ts: "1" },
        { channel: { name: "b" }, username: "u2", text: "second", ts: "2" },
      ];
      const result = formatSearchResults(matches);
      expect(result).toContain("Result 1");
      expect(result).toContain("Result 2");
    });

    it("handles missing fields gracefully", () => {
      const matches = [{ ts: "1" }];
      const result = formatSearchResults(matches);
      expect(result).toContain("unknown-channel");
      expect(result).toContain("unknown-user");
      expect(result).toContain("(empty)");
    });
  });

  describe("formatMessages", () => {
    it("returns empty message for no messages", () => {
      expect(formatMessages([])).toBe("No messages returned.");
    });

    it("formats messages with user resolution", () => {
      const messages = [
        { user: "U123", text: "Hello", ts: "1700000000.000000" },
        { user: "U456", text: "World", ts: "1700000001.000000" },
      ];
      const userNames = new Map([
        ["U123", "Alice"],
        ["U456", "Bob"],
      ]);
      const result = formatMessages(messages, userNames);
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
      expect(result).toContain("Hello");
      expect(result).toContain("World");
    });

    it("shows thread info for parent messages", () => {
      const messages = [
        {
          user: "U1",
          text: "Thread starter",
          ts: "1",
          thread_ts: "1",
          reply_count: 5,
        },
      ];
      const result = formatMessages(messages);
      expect(result).toContain("5 replies");
      expect(result).toContain("thread_ts: 1");
    });
  });

  describe("extractStructuredMatches", () => {
    it("extracts structured data from raw matches", () => {
      const raw = [
        {
          channel: { name: "general" },
          username: "alice",
          text: "  spaced   text  ",
          ts: "1700000000.000000",
          permalink: "https://slack.com/link",
        },
      ];
      const result = extractStructuredMatches(raw);
      expect(result).toHaveLength(1);
      expect(result[0].channel).toBe("general");
      expect(result[0].author).toBe("alice");
      expect(result[0].text).toBe("spaced text");
      expect(result[0].permalink).toBe("https://slack.com/link");
    });
  });

  describe("extractStructuredMessages", () => {
    it("resolves user names when provided", () => {
      const raw = [{ user: "U1", text: "hello", ts: "1" }];
      const names = new Map([["U1", "Alice"]]);
      const result = extractStructuredMessages(raw, names);
      expect(result[0].author).toBe("Alice");
    });

    it("falls back to raw user ID without names", () => {
      const raw = [{ user: "U1", text: "hello", ts: "1" }];
      const result = extractStructuredMessages(raw);
      expect(result[0].author).toBe("U1");
    });
  });
});
