/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior Proof for explicit skill usage across Pi 1.0 and Pi 1.2 run-start shapes. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadUsageMap } from "../lib/usage-store.ts";

const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";
const originalAgentDir = process.env[AGENT_DIR_ENV];
const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function expandedSkillPrompt(name: string): string {
  return `<skill name="${name}" location="/tmp/${name}/SKILL.md">\n# ${name}\n</skill>`;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (originalAgentDir === undefined) delete process.env[AGENT_DIR_ENV];
  else process.env[AGENT_DIR_ENV] = originalAgentDir;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  vi.restoreAllMocks();
});

describe("SF Skills before_agent_start usage signal", () => {
  it("counts Pi 1.0 and Pi 1.2 user starts but ignores custom-message starts", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sf-skills-run-start-"));
    tempDirs.push(root);
    const agentDir = path.join(root, "agent");
    const cwd = path.join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    process.env[AGENT_DIR_ENV] = agentDir;
    process.env.HOME = root;

    const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
    const pi = {
      on: vi.fn((name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
      registerCommand: vi.fn(),
      getCommands: vi.fn(() => []),
    };

    const { default: sfSkills } = await import("../index.ts");
    sfSkills(pi as never);
    const handler = handlers.get("before_agent_start")?.[0];
    expect(handler).toBeDefined();

    const prompt = expandedSkillPrompt("sf-apex");
    await handler?.({ type: "before_agent_start", prompt }, { cwd });
    await handler?.({ type: "before_agent_start", messageType: "user", prompt }, { cwd });
    await handler?.(
      {
        type: "before_agent_start",
        messageType: "custom",
        message: { customType: "follow-up", content: "continue" },
      },
      { cwd },
    );

    expect(loadUsageMap("global", cwd).get("sf-apex")?.count).toBe(2);
  });
});
