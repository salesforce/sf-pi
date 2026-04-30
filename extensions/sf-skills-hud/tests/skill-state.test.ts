/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  buildSessionContext,
  type SessionEntry,
  type SlashCommandInfo,
} from "@mariozechner/pi-coding-agent";
import { buildSkillsHudState } from "../lib/skill-state.ts";

const CWD = "/workspace/project";

function skillCommand(name: string, filePath: string): SlashCommandInfo {
  return {
    name: `skill:${name}`,
    description: `${name} skill`,
    source: "skill",
    sourceInfo: {
      path: filePath,
      source: "project",
      scope: "project",
      origin: "top-level",
    },
  };
}

function messageEntry(
  id: string,
  parentId: string | null,
  message: Record<string, unknown>,
): SessionEntry {
  return {
    type: "message",
    id,
    parentId,
    timestamp: `2026-01-01T00:00:0${id}Z`,
    message: message as never,
  };
}

function compactionEntry(id: string, parentId: string, firstKeptEntryId: string): SessionEntry {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: `2026-01-01T00:00:0${id}Z`,
    summary: "Compacted earlier work",
    firstKeptEntryId,
    tokensBefore: 1234,
  };
}

function userMessage(content: string): Record<string, unknown> {
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  };
}

function assistantToolCall(path: string): Record<string, unknown> {
  return {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "tool-1",
        name: "read",
        arguments: { path },
      },
    ],
    api: "responses",
    provider: "anthropic",
    model: "claude-sonnet",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

describe("sf-skills-hud skill state", () => {
  it("marks explicit skill blocks as live", () => {
    const commands = [skillCommand("sf-apex", "/skills/sf-apex/SKILL.md")];
    const entries: SessionEntry[] = [
      messageEntry(
        "1",
        null,
        userMessage(
          '<skill name="sf-apex" location="/skills/sf-apex/SKILL.md">\nUse Apex guidance\n</skill>',
        ),
      ),
    ];

    const state = buildSkillsHudState({
      branchEntries: entries,
      sessionContext: buildSessionContext(entries),
      commands,
      cwd: CWD,
    });

    expect(state.live.map((skill) => skill.name)).toEqual(["sf-apex"]);
    expect(state.earlier).toEqual([]);
  });

  it("detects live skills from read(SKILL.md) tool calls", () => {
    const commands = [skillCommand("sf-testing", "/skills/sf-testing/SKILL.md")];
    const entries: SessionEntry[] = [
      messageEntry("1", null, assistantToolCall("/skills/sf-testing/SKILL.md")),
    ];

    const state = buildSkillsHudState({
      branchEntries: entries,
      sessionContext: buildSessionContext(entries),
      commands,
      cwd: CWD,
    });

    expect(state.live.map((skill) => skill.name)).toEqual(["sf-testing"]);
    expect(state.live[0]?.evidence).toContain("read");
  });

  it("falls back to the SKILL.md directory name when skill commands are unavailable", () => {
    const entries: SessionEntry[] = [
      messageEntry("1", null, assistantToolCall("/skills/sf-flow/SKILL.md")),
    ];

    const state = buildSkillsHudState({
      branchEntries: entries,
      sessionContext: buildSessionContext(entries),
      commands: [],
      cwd: CWD,
    });

    expect(state.live.map((skill) => skill.name)).toEqual(["sf-flow"]);
  });

  it("moves older skill usage to earlier when compaction removes it from active context", () => {
    const commands = [skillCommand("sf-apex", "/skills/sf-apex/SKILL.md")];
    const entries: SessionEntry[] = [
      messageEntry(
        "1",
        null,
        userMessage(
          '<skill name="sf-apex" location="/skills/sf-apex/SKILL.md">\nUse Apex guidance\n</skill>',
        ),
      ),
      messageEntry("2", "1", userMessage("keep this user message after compaction")),
      compactionEntry("3", "2", "2"),
    ];

    const state = buildSkillsHudState({
      branchEntries: entries,
      sessionContext: buildSessionContext(entries),
      commands,
      cwd: CWD,
    });

    expect(state.live).toEqual([]);
    expect(state.earlier.map((skill) => skill.name)).toEqual(["sf-apex"]);
  });
});
