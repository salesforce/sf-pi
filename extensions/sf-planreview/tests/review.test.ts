/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../../../lib/common/manager-deep-link.ts";
import {
  cleanupReviewSnapshot,
  createReviewSnapshot,
  fileReviewSnapshot,
  getLastAssistantReview,
  listReviewDataDirs,
  prepareFileReview,
  reviewSourceChanged,
} from "../lib/review.ts";
import { getRegisteredDoctors } from "../../../lib/common/doctor/registry.ts";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));

const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-plannotator-review-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir: string;
beforeEach(() => {
  agentDir = mkdtempSync(path.join(cwd, "agent-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
  vi.mocked(spawnSync).mockReset();
});
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

function mockPi() {
  const pluginRoot = path.join(cwd, "plugin");
  mkdirSync(path.join(pluginRoot, "bin"), { recursive: true });
  const binary = path.join(pluginRoot, "bin", "plannotator-tui.exe");
  writeFileSync(binary, "fixture", { mode: 0o700 });
  const listeners = new Map<string, (request: SfPiManagerOpenRequest) => void>();
  const pi = {
    events: {
      emit: (channel: string, request: SfPiManagerOpenRequest) => listeners.get(channel)?.(request),
      on: (channel: string, handler: (request: SfPiManagerOpenRequest) => void) =>
        listeners.set(channel, handler),
    },
    on: vi.fn(),
    exec: vi.fn(async (command: string, args: string[]) => {
      if (command === "plannotator-tui" || command === binary)
        return { stdout: "plannotator-tui 0.9.4", stderr: "", code: 0 };
      if (command === "herdr" && args.includes("list"))
        return {
          stdout: JSON.stringify({
            result: {
              plugins: [
                {
                  plugin_id: "annotate",
                  enabled: true,
                  plugin_root: pluginRoot,
                  source: { kind: "github", owner: "plannotator", repo: "herdr-annotate" },
                  panes: [{ id: "doc" }],
                  actions: [{ id: "open" }],
                },
              ],
            },
          }),
          stderr: "",
          code: 0,
        };
      if (command === "herdr" && args.includes("open"))
        return {
          stdout: '{"result":{"plugin_pane":{"pane":{"pane_id":"test-review"}}}}',
          stderr: "",
          code: 0,
        };
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }),
    registerCommand: vi.fn(),
    appendEntry: vi.fn(),
    sendUserMessage: vi.fn(),
  };
  return { pi, listeners };
}

function ctx(branch: unknown[] = []) {
  return {
    hasUI: true,
    mode: "tui",
    cwd,
    ui: { notify: vi.fn(), confirm: vi.fn() },
    sessionManager: { getBranch: () => branch },
  };
}

describe("sf-planreview review", () => {
  it("selects the last assistant text on the active branch, not a tool result", () => {
    const review = getLastAssistantReview([
      {
        id: "previous",
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Earlier" }] },
      },
      {
        id: "last",
        type: "message",
        message: { role: "assistant", content: [{ type: "text", text: "Latest plan" }] },
      },
      {
        id: "tool",
        type: "message",
        message: { role: "toolResult", content: [{ type: "text", text: "Not an answer" }] },
      },
    ]);
    expect(review).toEqual({ entryId: "last", text: "Latest plan" });
  });

  it("prepares an exact file and refuses a secret-like or oversized file", () => {
    writeFileSync(path.join(cwd, "plan.md"), "# Public plan\n");
    const plan = realpathSync(path.join(cwd, "plan.md"));
    expect(prepareFileReview(cwd, "plan.md")).toEqual(plan);
    const original = fileReviewSnapshot(cwd, "plan.md");
    expect(original.file).not.toBe(plan);
    expect(readFileSync(original.file, "utf8")).toContain("# Public plan");
    writeFileSync(plan, "# Revised plan\n");
    expect(readFileSync(original.file, "utf8")).toContain("# Public plan");
    expect(reviewSourceChanged(original)).toBe(true);
    cleanupReviewSnapshot(original);
    expect(() => readFileSync(original.file)).toThrow();
    writeFileSync(path.join(cwd, "a plan.md"), "# Spaces in name\n");
    expect(prepareFileReview(cwd, '"a plan.md"')).toBe(realpathSync(path.join(cwd, "a plan.md")));
    writeFileSync(path.join(cwd, "report.json"), '{"result":"ok"}');
    const report = fileReviewSnapshot(cwd, "report.json");
    expect(path.basename(report.file)).toMatch(/^report\.json-review-[0-9a-f-]{36}\.md$/);
    expect(readFileSync(report.file, "utf8")).toContain("report.json");
    writeFileSync(path.join(cwd, ".env"), "TOKEN=example");
    expect(() => prepareFileReview(cwd, ".env")).toThrow(/sensitive/i);
    writeFileSync(path.join(cwd, "large.md"), "x".repeat(1_048_577));
    expect(() => prepareFileReview(cwd, "large.md")).toThrow(/large/i);
    writeFileSync(path.join(cwd, "graphic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(() => fileReviewSnapshot(cwd, "graphic.png")).toThrow(/text/i);
  });

  it("contributes read-only checks to the shared SF Pi doctor", async () => {
    const { pi } = mockPi();
    const { default: factory } = await import("../index.ts");
    factory(pi as never);
    try {
      const registered = getRegisteredDoctors().find(
        (item) => item.extensionId === "sf-planreview",
      );
      expect(registered).toBeDefined();
      const report = await registered!.provider(cwd);
      expect(report.checks.map((item) => item.id)).toContain("planreview.herdr");
      expect(report.checks.map((item) => item.id)).toContain("planreview.standalone");
    } finally {
      const shutdown = pi.on.mock.calls.find(([name]) => name === "session_shutdown")?.[1];
      shutdown?.();
    }
  });

  it("does not install third-party software without an explicit confirmation", async () => {
    const { pi } = mockPi();
    const { default: factory } = await import("../index.ts");
    factory(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
    const context = ctx();
    context.ui.confirm.mockResolvedValue(false);
    await command.handler("setup tui", context as never);
    expect(context.ui.confirm).toHaveBeenCalledOnce();
    expect(
      pi.exec.mock.calls.some(([name, args]) => name === "herdr" && args.includes("install")),
    ).toBe(false);
    pi.on.mock.calls.find(([name]) => name === "session_shutdown")?.[1]?.();
  });

  it("uses a pinned official Herdr plugin source only after setup approval", async () => {
    const { pi } = mockPi();
    const fallback = pi.exec.getMockImplementation();
    let installed = false;
    pi.exec.mockImplementation(async (command: string, args: string[]) => {
      if (command === "herdr" && args.includes("list") && !installed)
        return { stdout: '{"result":{"plugins":[]}}', stderr: "", code: 0 };
      if (command === "herdr" && args.includes("install")) {
        installed = true;
        return { stdout: "installed", stderr: "", code: 0 };
      }
      return fallback!(command, args);
    });
    const { default: factory } = await import("../index.ts");
    factory(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
    const context = ctx();
    context.ui.confirm.mockResolvedValue(true);
    await command.handler("setup herdr", context as never);
    expect(context.ui.confirm).toHaveBeenCalledOnce();
    const install = pi.exec.mock.calls.find(
      ([name, args]) => name === "herdr" && args.includes("install"),
    );
    expect(install?.[1]).toEqual(expect.arrayContaining(["plannotator/herdr-annotate", "--ref"]));
    expect(context.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("installed and verified"),
      "info",
    );
  });

  it("clears only private review snapshots after explicit confirmation", async () => {
    const { pi } = mockPi();
    const { default: factory } = await import("../index.ts");
    factory(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
    const snapshot = createReviewSnapshot("# Private review", "plan.md");
    const context = ctx();
    context.ui.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await command.handler("cleanup", context as never);
    expect(listReviewDataDirs()).toHaveLength(1);
    await command.handler("cleanup", context as never);
    expect(listReviewDataDirs()).toHaveLength(0);
    expect(() => readFileSync(snapshot.file)).toThrow();
    expect(pi.exec).not.toHaveBeenCalled();
  });

  it("routes standalone feedback once and flags a changed source", async () => {
    const prevHerdr = process.env.HERDR_ENV;
    const prevPane = process.env.HERDR_PANE_ID;
    process.env.HERDR_ENV = "0";
    delete process.env.HERDR_PANE_ID;
    const file = path.join(cwd, "stale-plan.md");
    writeFileSync(file, "# Original plan\n");
    try {
      const { pi } = mockPi();
      vi.mocked(spawnSync).mockImplementation((_binary, args) => {
        if (args?.[0] === "--export")
          return { status: 0, stdout: "A reviewer asked for a change." } as ReturnType<
            typeof spawnSync
          >;
        writeFileSync(file, "# Changed plan\n");
        return { status: 0 } as ReturnType<typeof spawnSync>;
      });
      const { default: factory } = await import("../index.ts");
      factory(pi as never);
      const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
      const context = ctx();
      const stop = vi.fn();
      const start = vi.fn();
      context.ui.confirm.mockResolvedValue(true);
      type TuiFactory = (
        tui: { stop: () => void; start: () => void; requestRender: () => void },
        theme: unknown,
        keys: unknown,
        done: (code: number | null) => void,
      ) => unknown;
      (context.ui as Record<string, unknown>).custom = async (review: TuiFactory) => {
        let result: number | null = null;
        review({ stop, start, requestRender: vi.fn() }, {}, {}, (code) => {
          result = code;
        });
        return result;
      };
      await command.handler('file "stale-plan.md"', context as never);
      expect(stop).toHaveBeenCalledOnce();
      expect(start).toHaveBeenCalledOnce();
      expect(pi.sendUserMessage).toHaveBeenCalledOnce();
      expect(pi.sendUserMessage.mock.calls[0]?.[0]).toContain("source changed since review began");
      expect(listReviewDataDirs()).toHaveLength(0);
    } finally {
      if (prevHerdr === undefined) delete process.env.HERDR_ENV;
      else process.env.HERDR_ENV = prevHerdr;
      if (prevPane === undefined) delete process.env.HERDR_PANE_ID;
      else process.env.HERDR_PANE_ID = prevPane;
    }
  });

  it("explains an empty review calmly without opening a pane", async () => {
    const { pi } = mockPi();
    const { default: factory } = await import("../index.ts");
    factory(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
    expect(command).toBeDefined();
    const context = ctx();
    await command.handler("last", context as never);
    expect(context.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Nothing to review yet"),
      "info",
    );
    expect(context.ui.notify.mock.calls[0]?.[0]).toContain("/sf-planreview last");
    expect(pi.exec).not.toHaveBeenCalled();
  });

  it("guides the user when a file is missing or its path was omitted", async () => {
    const { pi } = mockPi();
    const { default: factory } = await import("../index.ts");
    factory(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
    const missingArgument = ctx();
    await command.handler("file", missingArgument as never);
    expect(missingArgument.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("/sf-planreview file <path>"),
      "info",
    );
    expect(pi.exec).not.toHaveBeenCalled();

    const missingFile = ctx();
    await command.handler("file missing-plan.md", missingFile as never);
    expect(missingFile.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("I couldn't find that file"),
      "info",
    );
    expect(
      pi.exec.mock.calls.some(([name, args]) => name === "herdr" && args.includes("open")),
    ).toBe(false);
  });

  it("attributes Herdr feedback to the reviewed file and flags stale source through Pi input", async () => {
    const prev = { HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "test-origin";
    try {
      writeFileSync(path.join(cwd, "herdr-plan.md"), "# First version\n");
      const { pi } = mockPi();
      const { default: factory } = await import("../index.ts");
      factory(pi as never);
      const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
      await command.handler("file herdr-plan.md", ctx() as never);
      const [customType, data] = pi.appendEntry.mock.calls.at(-1) ?? [];
      expect(customType).toBe("sf-planreview-source");
      writeFileSync(path.join(cwd, "herdr-plan.md"), "# Changed version\n");
      const inputHandler = pi.on.mock.calls.find(([name]) => name === "input")?.[1];
      const result = inputHandler?.(
        { text: `# Annotations on ${data.reviewFile}\n\nA reviewer commented.` },
        ctx([{ type: "custom", customType, data }]),
      );
      expect(result).toMatchObject({
        action: "transform",
        text: expect.stringContaining("source changed since review began"),
      });
    } finally {
      if (prev.HERDR_ENV === undefined) delete process.env.HERDR_ENV;
      else process.env.HERDR_ENV = prev.HERDR_ENV;
      if (prev.HERDR_PANE_ID === undefined) delete process.env.HERDR_PANE_ID;
      else process.env.HERDR_PANE_ID = prev.HERDR_PANE_ID;
    }
  });

  it("uses the Manager for no-args and opens a Herdr review targeted at the current Pi pane", async () => {
    const prev = { HERDR_ENV: process.env.HERDR_ENV, HERDR_PANE_ID: process.env.HERDR_PANE_ID };
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "test-origin";
    try {
      const { pi, listeners } = mockPi();
      const opened: SfPiManagerOpenRequest[] = [];
      listeners.set(SF_PI_MANAGER_OPEN_EVENT, (request) => {
        opened.push(request);
        request.accept?.();
        request.resolve?.();
      });
      const { default: factory } = await import("../index.ts");
      factory(pi as never);
      const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-planreview")?.[1];
      await command.handler("", ctx() as never);
      expect(opened[0]?.route?.extensionId).toBe("sf-planreview");

      const context = ctx([
        {
          id: "answer",
          type: "message",
          message: { role: "assistant", content: [{ type: "text", text: "# Generic review" }] },
        },
      ]);
      await command.handler("last", context as never);
      const open = pi.exec.mock.calls.find(
        ([name, args]) => name === "herdr" && args.includes("open"),
      );
      expect(open?.[1]).toContain("--target-pane");
      expect(open?.[1]).toContain("test-origin");
      const fileArg = open?.[1].find((arg: string) => arg.startsWith("PLANNOTATOR_TUI_FILE="));
      expect(fileArg).toBeTruthy();
      expect(readFileSync(fileArg!.split("=").slice(1).join("="), "utf8")).toContain(
        "Generic review",
      );
      expect(pi.appendEntry).toHaveBeenCalledWith(
        "sf-planreview-source",
        expect.objectContaining({
          reviewFile: expect.stringMatching(/-review-[0-9a-f-]{36}\.md$/),
        }),
      );
      expect(pi.sendUserMessage).not.toHaveBeenCalled();
    } finally {
      if (prev.HERDR_ENV === undefined) delete process.env.HERDR_ENV;
      else process.env.HERDR_ENV = prev.HERDR_ENV;
      if (prev.HERDR_PANE_ID === undefined) delete process.env.HERDR_PANE_ID;
      else process.env.HERDR_PANE_ID = prev.HERDR_PANE_ID;
    }
  });
});
