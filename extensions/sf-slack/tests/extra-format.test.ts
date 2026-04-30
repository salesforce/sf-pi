/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-slack additional formatters.
 *
 * Tests for channel, user, and file formatting functions.
 */
import { describe, it, expect } from "vitest";
import {
  formatChannelInfo,
  extractStructuredChannel,
  formatUserInfo,
  extractStructuredUser,
  formatFileInfo,
  extractStructuredFile,
} from "../lib/format.ts";

describe("channel formatters", () => {
  it("formatChannelInfo handles a full channel", () => {
    const channel = {
      name: "general",
      id: "C123",
      topic: { value: "Welcome!" },
      purpose: { value: "General chat" },
      num_members: 42,
      created: 1700000000,
      is_archived: false,
      is_private: false,
      creator: "U001",
    };
    const result = formatChannelInfo(channel);
    expect(result).toContain("#general");
    expect(result).toContain("C123");
    expect(result).toContain("Welcome!");
    expect(result).toContain("42");
    expect(result).toContain("U001");
  });

  it("formatChannelInfo handles missing fields", () => {
    const result = formatChannelInfo({});
    expect(result).toContain("unknown");
    expect(result).toContain("(none)");
  });

  it("extractStructuredChannel extracts all fields", () => {
    const ch = {
      id: "C1",
      name: "test",
      topic: { value: "t" },
      purpose: { value: "p" },
      num_members: 5,
      is_private: true,
      is_archived: false,
      created: 1700000000,
      creator: "U1",
    };
    const s = extractStructuredChannel(ch);
    expect(s.id).toBe("C1");
    expect(s.name).toBe("test");
    expect(s.topic).toBe("t");
    expect(s.isPrivate).toBe(true);
    expect(s.numMembers).toBe(5);
  });
});

describe("user formatters", () => {
  it("formatUserInfo handles a full user", () => {
    const user = {
      id: "U123",
      name: "alice",
      profile: {
        display_name: "Alice",
        real_name: "Alice Smith",
        email: "alice@example.com",
        title: "Engineer",
        status_emoji: ":smile:",
        status_text: "Working",
      },
      tz_label: "Pacific Time",
      is_bot: false,
      is_admin: true,
    };
    const result = formatUserInfo(user);
    expect(result).toContain("Alice");
    expect(result).toContain("U123");
    expect(result).toContain("alice@example.com");
    expect(result).toContain("Engineer");
    expect(result).toContain("yes"); // is_admin
  });

  it("extractStructuredUser handles missing profile", () => {
    const s = extractStructuredUser({ id: "U1" });
    expect(s.id).toBe("U1");
    expect(s.displayName).toBe("(not set)");
    expect(s.email).toBe("(not available)");
  });
});

describe("file formatters", () => {
  it("formatFileInfo handles a full file", () => {
    const file = {
      name: "report.pdf",
      id: "F123",
      filetype: "pdf",
      size: 10240,
      created: 1700000000,
      user: "U1",
      permalink: "https://slack.com/files/F123",
      channels: ["C1", "C2"],
    };
    const result = formatFileInfo(file);
    expect(result).toContain("report.pdf");
    expect(result).toContain("F123");
    expect(result).toContain("pdf");
    expect(result).toContain("10KB");
    expect(result).toContain("C1, C2");
  });

  it("extractStructuredFile computes size", () => {
    const s = extractStructuredFile({ id: "F1", name: "test.txt", size: 2048, filetype: "txt" });
    expect(s.size).toBe("2KB");
    expect(s.type).toBe("txt");
  });

  it("extractStructuredFile handles missing fields", () => {
    const s = extractStructuredFile({});
    expect(s.id).toBe("unknown");
    expect(s.name).toBe("unknown");
    expect(s.size).toBe("unknown");
  });
});
