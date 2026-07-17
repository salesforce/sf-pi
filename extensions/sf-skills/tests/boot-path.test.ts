/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Boot-path guard for sf-skills.
 *
 * The funnel contract (and the repo's cache-first boot rule) is that NO skill
 * catalog work — `loadSkills`, per-root disk scans via `loadSkillsFromDir`, or
 * the gatherer — runs during session lifecycle hooks. The catalog is built
 * only on explicit `/sf-skills` open. These tests fail loudly if a future
 * change wires the heavy path into `session_start` / `message_end` / etc.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

type Handler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

// Spy on the Pi loader functions the gatherer uses. If any lifecycle hook
// triggers a catalog build, these counters move and the test fails.
const loadSkillsSpy = vi.fn(() => ({ skills: [], diagnostics: [] }));
const loadSkillsFromDirSpy = vi.fn(() => ({ skills: [], diagnostics: [] }));

vi.mock("@earendil-works/pi-coding-agent", async (importActual) => {
  const actual = await importActual<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    loadSkills: (...args: unknown[]) => loadSkillsSpy(...(args as [])),
    loadSkillsFromDir: (...args: unknown[]) => loadSkillsFromDirSpy(...(args as [])),
  };
});

function fakeCtx() {
  return {
    hasUI: false,
    cwd: process.cwd(),
    sessionManager: {
      getBranch: () => [],
      getLeafId: () => null,
    },
    ui: {
      notify: vi.fn(),
      custom: vi.fn(),
      setWorkingVisible: vi.fn(),
    },
  };
}

describe("sf-skills completions", () => {
  it("returns full argument-tail values for defaults subcommands", async () => {
    const { getSkillsArgumentCompletions } = await import("../index.ts");

    expect(getSkillsArgumentCompletions("def")?.map((item) => item.value)).toContain("defaults ");
    expect(getSkillsArgumentCompletions("defaults ")?.map((item) => item.value)).toEqual([
      "defaults status",
      "defaults install ",
      "defaults update ",
      "defaults link",
      "defaults unlink",
    ]);
    expect(getSkillsArgumentCompletions("defaults install pr")?.map((item) => item.value)).toEqual([
      "defaults install project",
    ]);
    expect(getSkillsArgumentCompletions("summary help")).toBeNull();
  });
});

describe("sf-skills boot path", () => {
  it("does not build the skill catalog during lifecycle hooks", async () => {
    loadSkillsSpy.mockClear();
    loadSkillsFromDirSpy.mockClear();

    const sfSkills = (await import("../index.ts")).default;

    const handlers = new Map<string, Handler[]>();
    const pi = {
      on: vi.fn((event: string, handler: Handler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      }),
      registerCommand: vi.fn(),
      getCommands: vi.fn(() => []),
    };

    sfSkills(pi as never);

    const ctx = fakeCtx();
    for (const event of [
      "session_start",
      "message_end",
      "session_tree",
      "session_compact",
      "session_shutdown",
    ]) {
      for (const handler of handlers.get(event) ?? []) {
        await handler({ reason: "startup", prompt: "" }, ctx);
      }
    }

    expect(loadSkillsSpy).not.toHaveBeenCalled();
    expect(loadSkillsFromDirSpy).not.toHaveBeenCalled();
  });

  it("only references the gatherer from the command path, not session_start", () => {
    const source = readFileSync("extensions/sf-skills/index.ts", "utf8");
    // If gather is imported, it must not be invoked inside a session_start handler.
    if (source.includes("gatherCatalogInput")) {
      const sessionStartBlock = source.slice(
        source.indexOf('pi.on("session_start"'),
        source.indexOf('pi.on("message_end"') >= 0
          ? source.indexOf('pi.on("message_end"')
          : undefined,
      );
      expect(sessionStartBlock).not.toContain("gatherCatalogInput");
    }
  });
});
