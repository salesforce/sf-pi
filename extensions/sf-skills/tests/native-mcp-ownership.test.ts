/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proof that Pi, not SF Skills, owns MCP readiness and configuration. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function managedSkillWithMcpMetadata(): string {
  const root = mkdtempSync(path.join(tmpdir(), "sf-skills-native-mcp-"));
  tempDirs.push(root);
  const skillDir = path.join(
    root,
    "sf-skills",
    "effective",
    "skills",
    "experience-lwr-site-generate",
  );
  mkdirSync(skillDir, { recursive: true });
  const file = path.join(skillDir, "SKILL.md");
  writeFileSync(
    file,
    [
      "---",
      "metadata:",
      "  mcpTools:",
      "    metadata-experts:",
      "      tools: [execute_metadata_action]",
      "---",
      "# Experience site",
    ].join("\n"),
    "utf8",
  );
  return file;
}

describe("SF Skills native MCP ownership", () => {
  it("leaves MCP readiness and configuration to Pi's built-in MCP extension", async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
    const appendEntry = vi.fn();
    const pi = {
      events: { on: vi.fn(), emit: vi.fn() },
      on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
      registerCommand: vi.fn(),
      registerEntryRenderer: vi.fn(),
      appendEntry,
      getCommands: vi.fn(() => [{ name: "mcp" }]),
      getAllTools: vi.fn(() => [{ name: "mcp__metadata-experts__execute_metadata_action" }]),
    };
    const ctx = {
      hasUI: false,
      mode: "print",
      cwd: process.cwd(),
      sessionManager: { getBranch: () => [], getLeafId: () => null },
      ui: { notify: vi.fn(), custom: vi.fn(), setWorkingVisible: vi.fn() },
    };

    const { default: sfSkills } = await import("../index.ts");
    sfSkills(pi as never);
    for (const handler of handlers.get("session_start") ?? []) {
      await handler({ reason: "startup" }, ctx);
    }
    for (const handler of handlers.get("before_agent_start") ?? []) {
      await handler(
        {
          prompt: "hello",
          systemPromptOptions: {
            skills: [
              {
                name: "experience-lwr-site-generate",
                filePath: managedSkillWithMcpMetadata(),
                disableModelInvocation: false,
              },
            ],
          },
        },
        ctx,
      );
    }

    expect(appendEntry).not.toHaveBeenCalledWith("sf-skills-mcp-readiness", expect.anything());
  });
});
