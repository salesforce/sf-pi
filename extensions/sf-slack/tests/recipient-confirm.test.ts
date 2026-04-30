/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the `requireConfirmed*` helpers.
 *
 * We mock `resolveChannel` / `resolveUser` to return controlled
 * `ResolveResult` shapes, and we mock `ctx.ui.select` / `ctx.ui.input`
 * to script the interactive flow. No network, no real TUI.
 *
 * Scenarios covered:
 *   - High-confidence auto-confirm (no dialog)
 *   - Low-confidence interactive pick
 *   - Interactive "type exact name/ID" retry (single-step + multi-step loop)
 *   - Interactive cancel (Esc on select, Esc on input, Cancel button)
 *   - Headless ambiguous \u2192 fail with candidate list
 *   - Headless high-confidence below threshold \u2192 headless_unverified
 *   - Empty candidates \u2192 not_found (interactive gets a type-or-cancel prompt)
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import {
  AUTO_CONFIRM_THRESHOLD,
  requireConfirmedChannel,
  requireConfirmedUser,
  type ConfirmResult,
} from "../lib/recipient-confirm.ts";
import type { ResolveResult, ResolvedChannel, ResolvedUser } from "../lib/types.ts";
import * as resolveModule from "../lib/resolve.ts";

// The repo runs tsc with `strict: false`, which (perhaps surprisingly) does
// not perform control-flow narrowing on discriminated unions even with
// explicit `if (!result.ok) { ... }` guards. Use explicit Extract casts to
// read the failure fields so tsc stops complaining; the runtime assertion
// on result.ok still protects correctness.
type Fail = Extract<ConfirmResult, { ok: false }>;
function asFail(result: ConfirmResult): Fail {
  if (result.ok) throw new Error("expected ok=false but got ok=true");
  return result as Fail;
}

// ─── Fixtures ───────────────────────────────────────────────────────────

function channel(id: string, name: string, confidence: number, source = "test"): ResolvedChannel {
  return { id, name, confidence, source };
}

function user(id: string, displayName: string, confidence: number, source = "test"): ResolvedUser {
  return {
    id,
    handle: displayName,
    displayName,
    realName: displayName,
    email: "",
    confidence,
    source,
  };
}

function channelResult(
  input: string,
  candidates: ResolvedChannel[],
): ResolveResult<ResolvedChannel> {
  const best = candidates[0];
  return {
    ok: candidates.length > 0,
    type: "channel",
    input,
    best,
    candidates,
    confidence: best?.confidence ?? 0,
    strategy: ["test"],
    warnings: [],
  };
}

function userResult(input: string, candidates: ResolvedUser[]): ResolveResult<ResolvedUser> {
  const best = candidates[0];
  return {
    ok: candidates.length > 0,
    type: "user",
    input,
    best,
    candidates,
    confidence: best?.confidence ?? 0,
    strategy: ["test"],
    warnings: [],
  };
}

// ─── ExtensionContext mock ──────────────────────────────────────────────

interface MockUI {
  select: Mock<(title: string, options: string[], opts?: unknown) => Promise<string | undefined>>;
  input: Mock<(title: string, placeholder?: string, opts?: unknown) => Promise<string | undefined>>;
}

function makeCtx(hasUI: boolean): {
  ctx: Parameters<typeof requireConfirmedChannel>[0];
  ui: MockUI;
} {
  const ui: MockUI = {
    select: vi.fn(),
    input: vi.fn(),
  };
  const ctx = { hasUI, ui } as unknown as Parameters<typeof requireConfirmedChannel>[0];
  return { ctx, ui };
}

// ─── Resolver-mock helpers ──────────────────────────────────────────────

let resolveChannelMock: ReturnType<typeof vi.spyOn> | undefined;
let resolveUserMock: ReturnType<typeof vi.spyOn> | undefined;

function queueChannel(responses: ResolveResult<ResolvedChannel>[]): void {
  let call = 0;
  resolveChannelMock = vi.spyOn(resolveModule, "resolveChannel").mockImplementation(async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return next;
  });
}

function queueUser(responses: ResolveResult<ResolvedUser>[]): void {
  let call = 0;
  resolveUserMock = vi.spyOn(resolveModule, "resolveUser").mockImplementation(async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return next;
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("requireConfirmedChannel", () => {
  beforeEach(() => {
    resolveChannelMock = undefined;
  });

  afterEach(() => {
    resolveChannelMock?.mockRestore();
  });

  it("auto-confirms at exactly the threshold", async () => {
    queueChannel([
      channelResult("support", [channel("C1", "project-support", AUTO_CONFIRM_THRESHOLD)]),
    ]);
    const { ctx } = makeCtx(true);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "support");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipient.type).toBe("channel");
      if (result.recipient.type === "channel") {
        expect(result.recipient.channel.id).toBe("C1");
      }
    }
  });

  it("auto-confirms high-confidence matches without a dialog", async () => {
    queueChannel([channelResult("proj", [channel("C1", "project-support", 0.99)])]);
    const { ctx, ui } = makeCtx(true);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "proj");

    expect(result.ok).toBe(true);
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
  });

  it("prompts for a pick when confidence is below the threshold", async () => {
    queueChannel([
      channelResult("general", [
        channel("C1", "general-support", 0.7),
        channel("C2", "general-chat", 0.65),
      ]),
    ]);
    const { ctx, ui } = makeCtx(true);

    // User picks the second option from the visible list.
    ui.select.mockImplementation(async (_title, options) => options[1]);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "general");

    expect(result.ok).toBe(true);
    if (result.ok && result.recipient.type === "channel") {
      expect(result.recipient.channel.id).toBe("C2");
    }
    expect(ui.select).toHaveBeenCalledOnce();
  });

  it('always includes a "Type exact name/ID instead" option', async () => {
    queueChannel([channelResult("foo", [channel("C1", "foo-bar", 0.7)])]);
    const { ctx, ui } = makeCtx(true);
    ui.select.mockImplementation(async () => "Cancel");

    await requireConfirmedChannel(ctx, "xoxp-test", "foo");

    const passedOptions = ui.select.mock.calls[0][1];
    expect(passedOptions).toEqual(
      expect.arrayContaining([expect.stringContaining("Type exact name/ID")]),
    );
    expect(passedOptions).toContain("Cancel");
  });

  it('loops when the user picks "Type exact" and re-resolves', async () => {
    queueChannel([
      // First resolve: ambiguous
      channelResult("eng", [channel("C1", "engineering", 0.7)]),
      // Second resolve (after user types "project-support"): high-confidence
      channelResult("project-support", [channel("C99", "project-support", 0.99)]),
    ]);
    const { ctx, ui } = makeCtx(true);

    ui.select.mockImplementationOnce(async (_title, options) => {
      // First round: user wants to type the exact name
      return options.find((o) => o.includes("Type exact"));
    });
    ui.input.mockResolvedValueOnce("project-support");

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    expect(result.ok).toBe(true);
    if (result.ok && result.recipient.type === "channel") {
      expect(result.recipient.channel.id).toBe("C99");
    }
    // One initial select, then auto-confirmed on the retry \u2014 so exactly one select call.
    expect(ui.select).toHaveBeenCalledTimes(1);
    expect(ui.input).toHaveBeenCalledOnce();
  });

  it("loops indefinitely through multiple type-exact retries", async () => {
    queueChannel([
      channelResult("eng", [channel("C1", "engineering", 0.7)]), // round 1: ambiguous
      channelResult("ops", [channel("C2", "operations", 0.7)]), // round 2: still ambiguous
      channelResult("support", [channel("C3", "support-central", 0.95)]), // round 3: confirmed
    ]);
    const { ctx, ui } = makeCtx(true);

    ui.select
      .mockImplementationOnce(async (_t, o) => o.find((s) => s.includes("Type exact"))!)
      .mockImplementationOnce(async (_t, o) => o.find((s) => s.includes("Type exact"))!);
    ui.input.mockResolvedValueOnce("ops").mockResolvedValueOnce("support");

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    expect(result.ok).toBe(true);
    if (result.ok && result.recipient.type === "channel") {
      expect(result.recipient.channel.id).toBe("C3");
    }
    expect(ui.select).toHaveBeenCalledTimes(2);
    expect(ui.input).toHaveBeenCalledTimes(2);
  });

  it("cancels when the user picks the Cancel option", async () => {
    queueChannel([channelResult("eng", [channel("C1", "engineering", 0.7)])]);
    const { ctx, ui } = makeCtx(true);
    ui.select.mockResolvedValueOnce("Cancel");

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    const fail = asFail(result);
    expect(fail.reason).toBe("cancelled");
  });

  it("cancels when the user Esc's the select dialog", async () => {
    queueChannel([channelResult("eng", [channel("C1", "engineering", 0.7)])]);
    const { ctx, ui } = makeCtx(true);
    ui.select.mockResolvedValueOnce(undefined);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    const fail = asFail(result);
    expect(fail.reason).toBe("cancelled");
  });

  it("cancels when the user Esc's the type-exact input", async () => {
    queueChannel([channelResult("eng", [channel("C1", "engineering", 0.7)])]);
    const { ctx, ui } = makeCtx(true);
    ui.select.mockImplementationOnce(async (_t, o) => o.find((s) => s.includes("Type exact"))!);
    ui.input.mockResolvedValueOnce(undefined);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    const fail = asFail(result);
    expect(fail.reason).toBe("cancelled");
  });

  it("treats an empty type-exact input as cancel (no loop)", async () => {
    queueChannel([channelResult("eng", [channel("C1", "engineering", 0.7)])]);
    const { ctx, ui } = makeCtx(true);
    ui.select.mockImplementationOnce(async (_t, o) => o.find((s) => s.includes("Type exact"))!);
    ui.input.mockResolvedValueOnce("   ");

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    const fail = asFail(result);
    expect(fail.reason).toBe("cancelled");
  });

  it("handles an empty candidate list in interactive mode", async () => {
    queueChannel([channelResult("nope", [])]);
    const { ctx, ui } = makeCtx(true);
    // User picks the type-exact option even with no candidates.
    ui.select.mockImplementationOnce(async (_t, o) => o.find((s) => s.includes("Type exact"))!);
    ui.input.mockResolvedValueOnce(undefined);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "nope");

    const fail = asFail(result);
    expect(fail.reason).toBe("cancelled");
  });

  it("refuses outright on missing ref", async () => {
    const { ctx, ui } = makeCtx(true);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "   ");

    const fail = asFail(result);
    expect(fail.reason).toBe("not_found");
    expect(ui.select).not.toHaveBeenCalled();
  });
});

describe("requireConfirmedChannel \u2014 headless", () => {
  afterEach(() => {
    resolveChannelMock?.mockRestore();
  });

  it("fails loudly when no UI and confidence is below threshold", async () => {
    queueChannel([channelResult("eng", [channel("C1", "engineering", 0.7)])]);
    const { ctx, ui } = makeCtx(false);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    const fail = asFail(result);
    expect(fail.reason).toBe("headless_unverified");
    expect(fail.message).toMatch(/Candidates:/);
    expect(fail.message).toContain("engineering");
    expect(ui.select).not.toHaveBeenCalled();
  });

  it("still auto-confirms high-confidence matches in headless mode", async () => {
    queueChannel([channelResult("eng", [channel("C1", "engineering", 0.99)])]);
    const { ctx } = makeCtx(false);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "eng");

    expect(result.ok).toBe(true);
    if (result.ok && result.recipient.type === "channel") {
      expect(result.recipient.channel.id).toBe("C1");
    }
  });

  it("returns ambiguous_headless when no candidates resolve", async () => {
    queueChannel([channelResult("nope", [])]);
    const { ctx } = makeCtx(false);

    const result = await requireConfirmedChannel(ctx, "xoxp-test", "nope");

    const fail = asFail(result);
    expect(fail.reason).toBe("ambiguous_headless");
    expect(fail.message).toMatch(/Re-invoke with an exact name or ID/);
  });
});

describe("requireConfirmedUser", () => {
  beforeEach(() => {
    resolveUserMock = undefined;
  });
  afterEach(() => {
    resolveUserMock?.mockRestore();
  });

  it("auto-confirms high-confidence user lookups", async () => {
    queueUser([userResult("jane", [user("U1", "Jane Doe", 0.99)])]);
    const { ctx } = makeCtx(true);

    const result = await requireConfirmedUser(ctx, "xoxp-test", "jane");

    expect(result.ok).toBe(true);
    if (result.ok && result.recipient.type === "user") {
      expect(result.recipient.user.id).toBe("U1");
    }
  });

  it("prompts for a pick when there are multiple low-confidence matches", async () => {
    queueUser([userResult("j", [user("U1", "Jane", 0.7), user("U2", "John", 0.68)])]);
    const { ctx, ui } = makeCtx(true);
    ui.select.mockImplementationOnce(async (_t, options) => options[1]);

    const result = await requireConfirmedUser(ctx, "xoxp-test", "j");

    expect(result.ok).toBe(true);
    if (result.ok && result.recipient.type === "user") {
      expect(result.recipient.user.id).toBe("U2");
    }
  });
});
