/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the small public surface of command-panel.ts.
 *
 * The TUI rendering itself is covered by manual smoke testing inside pi
 * (we can't easily mount Pi's KeybindingsManager + Theme in a vitest
 * env). What we *can* unit-test is:
 *
 *   1. The close-keyword contract — extensions rely on `exit` / `quit`
 *      always closing the panel.
 *   2. The lifecycle-action predicate exported from extension-toggle.ts —
 *      every panel that wires `performToggleExtension` passes this as
 *      `closeBeforeAction`. The lint `npm run check:panels` enforces the
 *      wiring; this test pins the predicate itself.
 */
import { describe, expect, it, vi } from "vitest";
import { matchesCloseKeyword, openCommandPanel } from "../command-panel.ts";
import { isLifecycleToggleAction } from "../extension-toggle.ts";

describe("matchesCloseKeyword", () => {
  it("matches the exact `exit` keyword", () => {
    expect(matchesCloseKeyword("exit")).toBe(true);
  });

  it("matches the exact `quit` keyword", () => {
    expect(matchesCloseKeyword("quit")).toBe(true);
  });

  it("does not match partial keywords", () => {
    expect(matchesCloseKeyword("exi")).toBe(false);
    expect(matchesCloseKeyword("qui")).toBe(false);
  });

  it("is case-sensitive (callers normalize beforehand)", () => {
    // GroupedActionList lower-cases keystrokes before passing them in so the
    // match function itself stays simple. Document that contract here so a
    // refactor that drops the caller-side normalization breaks loudly.
    expect(matchesCloseKeyword("EXIT")).toBe(false);
    expect(matchesCloseKeyword("Quit")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(matchesCloseKeyword("")).toBe(false);
    expect(matchesCloseKeyword("save")).toBe(false);
    expect(matchesCloseKeyword("exitnow")).toBe(false);
  });
});

describe("openCommandPanel", () => {
  it("uses dialog UI instead of custom components outside TUI mode", async () => {
    const onAction = vi.fn();
    const ctx = {
      mode: "rpc",
      hasUI: true,
      cwd: process.cwd(),
      ui: {
        custom: vi.fn(async () => {
          throw new Error("custom UI should not be used in RPC mode");
        }),
        select: vi.fn(async (_title: string, options: string[]) => options[0]),
      },
    } as never;

    const result = await openCommandPanel(ctx, {
      title: "Test panel",
      actions: [
        { value: "status", label: "Show status", description: "Display status", group: "Status" },
        { value: "close", label: "Close", description: "Dismiss", group: "Lifecycle" },
      ],
      closeValue: "close",
      onAction,
    });

    expect(result).toBe("status");
    expect(onAction).toHaveBeenCalledWith("status");
    expect((ctx as { ui: { custom: ReturnType<typeof vi.fn> } }).ui.custom).not.toHaveBeenCalled();
  });

  it("returns null without UI instead of trying to render a panel", async () => {
    const result = await openCommandPanel(
      { mode: "print", hasUI: false, cwd: process.cwd(), ui: {} } as never,
      {
        title: "Test panel",
        actions: [
          { value: "status", label: "Show status", description: "Display status", group: "Status" },
        ],
        closeValue: "status",
      },
    );

    expect(result).toBeNull();
  });
});

describe("isLifecycleToggleAction", () => {
  // This predicate is what every /sf-* command panel passes as
  // `closeBeforeAction`. Changing the literal string would silently break
  // the close-before-reload contract in 9 extensions.
  it("matches the canonical lifecycle action id", () => {
    expect(isLifecycleToggleAction("lifecycle.toggle")).toBe(true);
  });

  it("rejects close, status, refresh, and unrelated values", () => {
    expect(isLifecycleToggleAction("close")).toBe(false);
    expect(isLifecycleToggleAction("status")).toBe(false);
    expect(isLifecycleToggleAction("refresh")).toBe(false);
    expect(isLifecycleToggleAction("help")).toBe(false);
    expect(isLifecycleToggleAction("")).toBe(false);
  });

  it("is exact-match (no prefix / case lenience)", () => {
    expect(isLifecycleToggleAction("Lifecycle.toggle")).toBe(false);
    expect(isLifecycleToggleAction("lifecycle.toggle.x")).toBe(false);
    expect(isLifecycleToggleAction("lifecycle-toggle")).toBe(false); // hyphen, not dot
  });
});
