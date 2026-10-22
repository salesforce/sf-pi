/* SPDX-License-Identifier: Apache-2.0 */
/** Registered Slack tool through Pi's real dialog stack and input components. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InteractiveMode, initTheme } from "@earendil-works/pi-coding-agent";
import { Container, type Component } from "@earendil-works/pi-tui";
import { registerResolveTool } from "../lib/resolve-tool.ts";
import type { ResolveResult, ResolvedChannel } from "../lib/types.ts";

vi.mock("../lib/auth.ts", () => ({ requireAuth: vi.fn(async () => ({ token: "test-token" })) }));
vi.mock("../lib/resolve.ts", () => ({
  resolveChannel: vi.fn(),
  resolveUser: vi.fn(),
  formatResolveResult: (result: unknown) => JSON.stringify(result),
}));
import { resolveChannel } from "../lib/resolve.ts";

function candidates(name: string): ResolveResult<ResolvedChannel> {
  const candidate = { id: `C_${name}_EXAMPLE`, name, confidence: 0.7, source: "test" };
  return {
    ok: true,
    input: name,
    type: "channel",
    best: candidate,
    candidates: [candidate],
    confidence: 0.7,
    strategy: [],
    warnings: [],
  };
}

function captureTool() {
  let execute: (...args: never[]) => Promise<{ details: ResolveResult<ResolvedChannel> }>;
  registerResolveTool({
    registerTool(definition: { execute: typeof execute }) {
      execute = definition.execute;
    },
  } as never);
  return (text: string, ui: unknown, options: { hasUI?: boolean; clarify?: boolean } = {}) =>
    execute(
      ...([
        `resolve-${text}`,
        { type: "channel", text, clarify: options.clarify },
        new AbortController().signal,
        undefined,
        { cwd: "/tmp/slack-dialog-proof", hasUI: options.hasUI ?? true, ui },
      ] as never[]),
    );
}

function nativeDialogs() {
  // Only terminal plumbing is fake. Stack ownership, completion, selection, and input
  // run on the installed Pi implementation via its extension UI context.
  const mode = Object.create(InteractiveMode.prototype);
  mode.extensionDialogs = [];
  mode.editor = new Container();
  mode.editorContainer = new Container();
  mode.programStatus = { setBlocked: vi.fn() };
  mode.ui = { setFocus: vi.fn(), requestRender: vi.fn() };
  const ui = mode.createExtensionUIContext();
  const visible = (): Component => mode.editorContainer.children[0];
  return { mode, ui, visible };
}

beforeEach(() => {
  vi.clearAllMocks();
  initTheme("dark", false);
  vi.mocked(resolveChannel).mockImplementation(async (_token, text) => candidates(text));
});

describe("slack_resolve native dialogs", () => {
  it("answers concurrent calls in stack order without mixing their results", async () => {
    const { mode, ui, visible } = nativeDialogs();
    const run = captureTool();
    const first = run("first", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(1));
    const second = run("second", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(2));
    visible().handleInput?.("\r");
    expect((await second).details).toMatchObject({ best: { name: "second" }, confidence: 1 });
    expect(mode.extensionDialogs).toHaveLength(1);
    visible().handleInput?.("\r");
    const result = (await first).details;
    expect(result).toMatchObject({ best: { name: "first" }, confidence: 1 });
    expect(result.warnings.join(" ")).not.toContain("Re-invoke serially");
    expect(mode.extensionDialogs).toHaveLength(0);
    expect(visible()).toBe(mode.editor);
  });

  it("cancels one selector without stranding another", async () => {
    const { mode, ui, visible } = nativeDialogs();
    const run = captureTool();
    const first = run("first", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(1));
    const second = run("second", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(2));
    visible().handleInput?.("\x1b");
    expect((await second).details.confidence).toBe(0.7);
    visible().handleInput?.("\r");
    expect((await first).details.confidence).toBe(1);
    expect(mode.extensionDialogs).toHaveLength(0);
  });

  it("restores a selector after an overlapping exact-name input completes", async () => {
    vi.mocked(resolveChannel).mockImplementation(async (_token, text) =>
      text === "missing"
        ? { ...candidates(text), ok: false, best: undefined, candidates: [] }
        : { ...candidates(text), confidence: text === "exact" ? 1 : 0.7 },
    );
    const { mode, ui, visible } = nativeDialogs();
    const run = captureTool();
    const first = run("first", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(1));
    const missing = run("missing", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(2));
    visible().handleInput?.("exact");
    visible().handleInput?.("\r");
    expect((await missing).details).toMatchObject({ best: { name: "exact" }, confidence: 1 });
    visible().handleInput?.("\r");
    expect((await first).details.best?.name).toBe("first");
    expect(mode.extensionDialogs).toHaveLength(0);
  });

  it("cancels an exact-name input and restores the pending selector", async () => {
    vi.mocked(resolveChannel).mockImplementation(async (_token, text) =>
      text === "missing"
        ? { ...candidates(text), ok: false, best: undefined, candidates: [] }
        : candidates(text),
    );
    const { mode, ui, visible } = nativeDialogs();
    const run = captureTool();
    const first = run("first", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(1));
    const missing = run("missing", ui);
    await vi.waitFor(() => expect(mode.extensionDialogs).toHaveLength(2));
    visible().handleInput?.("\x1b");
    expect((await missing).details.ok).toBe(false);
    visible().handleInput?.("\r");
    expect((await first).details.confidence).toBe(1);
    expect(mode.extensionDialogs).toHaveLength(0);
  });

  it("keeps high-confidence results non-interactive", async () => {
    vi.mocked(resolveChannel).mockResolvedValue({ ...candidates("exact"), confidence: 1 });
    const { mode, ui } = nativeDialogs();
    expect((await captureTool()("exact", ui)).details.confidence).toBe(1);
    expect(mode.extensionDialogs).toHaveLength(0);
  });

  it.each([{ hasUI: false }, { clarify: false }])(
    "does not open dialogs for %j",
    async (options) => {
      const { mode, ui } = nativeDialogs();
      expect((await captureTool()("first", ui, options)).details.confidence).toBe(0.7);
      expect(mode.extensionDialogs).toHaveLength(0);
    },
  );
});
