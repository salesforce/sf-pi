/* SPDX-License-Identifier: Apache-2.0 */
/** /sf-fin sdk publish|pause: plan first, change only after explicit confirmation. */
import { describe, expect, it, vi } from "vitest";
import { handleCommand } from "../index.ts";
import type { FinService, ProcedureRequest } from "../lib/service.ts";

function fakeService() {
  const calls: ProcedureRequest[] = [];
  const procedure = vi.fn(async (_ctx: unknown, request: ProcedureRequest) => {
    calls.push(request);
    const execute = "execute" in request && request.execute === true;
    return execute
      ? { ok: true, text: "✅ Procedure is now live.", details: { phase: "execute" } }
      : {
          ok: true,
          text: "Plan: publish procedure 4242 — draft → live.\nEffect.",
          details: { phase: "plan" },
        };
  });
  return { service: { procedure } as unknown as FinService, calls };
}

function fakeCtx(confirm: boolean) {
  return {
    hasUI: true,
    cwd: "/project",
    ui: { confirm: vi.fn(async () => confirm), notify: vi.fn() },
  };
}

describe("/sf-fin sdk publish|pause", () => {
  it("executes only after the user confirms the plan", async () => {
    const { service, calls } = fakeService();
    const ctx = fakeCtx(true);
    await handleCommand(service, ctx as never, "sdk publish 4242", false);
    expect(ctx.ui.confirm).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { operation: "publish", procedureId: "4242", execute: false },
      { operation: "publish", procedureId: "4242", execute: true },
    ]);
  });

  it("makes no change when the user declines", async () => {
    const { service, calls } = fakeService();
    const ctx = fakeCtx(false);
    await handleCommand(service, ctx as never, "sdk pause 4242", false);
    expect(calls).toEqual([{ operation: "pause", procedureId: "4242", execute: false }]);
    expect(ctx.ui.notify).toHaveBeenCalledWith("No changes were made.", "info");
  });

  it("only plans when there is no UI to confirm", async () => {
    const { service, calls } = fakeService();
    const ctx = { ...fakeCtx(true), hasUI: false };
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await handleCommand(service, ctx as never, "sdk publish 4242", false);
    info.mockRestore();
    expect(calls).toEqual([{ operation: "publish", procedureId: "4242", execute: false }]);
  });
});

describe("/sf-fin connect|disconnect agent", () => {
  it("prefills /login sf-fin-agent in TUI and refuses outside TUI", async () => {
    const setEditorText = vi.fn();
    const notify = vi.fn();
    const ctx = { mode: "tui", hasUI: true, ui: { setEditorText, notify } };
    await handleCommand({} as FinService, ctx as never, "connect agent", false);
    expect(setEditorText).toHaveBeenCalledWith("/login sf-fin-agent");
    const rpc = { mode: "rpc", hasUI: true, ui: { setEditorText: vi.fn(), notify: vi.fn() } };
    await handleCommand({} as FinService, rpc as never, "connect agent", false);
    expect(rpc.ui.setEditorText).not.toHaveBeenCalled();
  });

  it("does not prefill a logout when no key is saved", async () => {
    const setEditorText = vi.fn();
    const notify = vi.fn();
    vi.stubEnv("PI_CODING_AGENT_DIR", "/nonexistent-sf-fin-test-dir");
    vi.stubEnv("FIN_AGENT_API_KEY", "");
    await handleCommand(
      {} as FinService,
      { mode: "tui", hasUI: true, ui: { setEditorText, notify } } as never,
      "disconnect agent",
      false,
    );
    vi.unstubAllEnvs();
    expect(setEditorText).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("No Fin Agent API key is saved.", "info");
  });
});
