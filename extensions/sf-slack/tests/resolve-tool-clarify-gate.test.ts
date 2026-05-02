/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression tests for the slack_resolve clarify gate.
 *
 * Parallel tool calls must not stack modal dialogs on the TUI. When a
 * clarify dialog is already pending, concurrent calls must return
 * immediately (undefined from the gate) instead of blocking on
 * ctx.ui.select / ctx.ui.input behind the first dialog.
 *
 * See bug: 10 parallel slack_resolve calls wedged the session because
 * every low-confidence result tried to open its own modal.
 */
import { afterEach, describe, expect, it } from "vitest";
import { __resetClarifyGateForTests, __withClarifyGateForTests } from "../lib/resolve-tool.ts";

afterEach(() => {
  __resetClarifyGateForTests();
});

describe("slack_resolve clarify gate", () => {
  it("lets a single call through and returns its value", async () => {
    const value = await __withClarifyGateForTests(async () => "picked");
    expect(value).toBe("picked");
  });

  it("releases the slot after the dialog completes so the next call gets through", async () => {
    const first = await __withClarifyGateForTests(async () => "first");
    const second = await __withClarifyGateForTests(async () => "second");
    expect(first).toBe("first");
    expect(second).toBe("second");
  });

  it("returns undefined from a concurrent call while another dialog is pending", async () => {
    let releaseFirst!: (value: string) => void;
    const firstPromise = __withClarifyGateForTests(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    // Let the first call take the slot.
    await Promise.resolve();

    const concurrentCalls = await Promise.all([
      __withClarifyGateForTests(async () => "second"),
      __withClarifyGateForTests(async () => "third"),
      __withClarifyGateForTests(async () => "fourth"),
    ]);
    expect(concurrentCalls).toEqual([undefined, undefined, undefined]);

    releaseFirst("first");
    expect(await firstPromise).toBe("first");

    // After the first resolves, subsequent calls can enter the gate again.
    const afterRelease = await __withClarifyGateForTests(async () => "after");
    expect(afterRelease).toBe("after");
  });

  it("releases the slot even if the dialog function throws", async () => {
    await expect(
      __withClarifyGateForTests(async () => {
        throw new Error("user cancelled");
      }),
    ).rejects.toThrow("user cancelled");
    const next = await __withClarifyGateForTests(async () => "ok");
    expect(next).toBe("ok");
  });
});
