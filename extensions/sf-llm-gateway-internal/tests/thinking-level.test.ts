/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the user-respecting thinking-level helper.
 *
 * Before this fix, `model_select` unconditionally called
 * `pi.setThinkingLevel("xhigh")` every time the active model was a gateway
 * model. That silently overwrote user-initiated level changes (e.g. after
 * a /thinking medium command) and silently inflated every turn into the
 * heavy-workload profile that correlates with Anthropic's intermittent
 * 500 window.
 *
 * The helper now:
 *   - applies the recommended default when nothing has been set yet
 *     (fresh session, first gateway switch), and
 *   - respects the user's level when they have changed it since we last
 *     set it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyGatewayDefaultThinkingLevel,
  __getLastAppliedThinkingLevelForTests,
  __resetThinkingLevelStateForTests,
} from "../index.ts";
import { DEFAULT_THINKING_LEVEL } from "../lib/config.ts";

type Level = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Minimal fake ExtensionAPI that records setThinkingLevel calls. */
function makeFakePi(initialLevel: Level) {
  let level: Level = initialLevel;
  const calls: Level[] = [];
  return {
    pi: {
      getThinkingLevel: () => level,
      setThinkingLevel: (next: Level) => {
        calls.push(next);
        level = next;
      },
    } as unknown as Parameters<typeof applyGatewayDefaultThinkingLevel>[0],
    get level() {
      return level;
    },
    calls,
  };
}

describe("applyGatewayDefaultThinkingLevel", () => {
  beforeEach(() => {
    __resetThinkingLevelStateForTests();
  });

  it("applies the extension's recommended default on first call of a fresh session", () => {
    const fake = makeFakePi("medium");
    const applied = applyGatewayDefaultThinkingLevel(fake.pi);

    expect(applied).toBe(true);
    expect(fake.level).toBe(DEFAULT_THINKING_LEVEL);
    expect(fake.calls).toEqual([DEFAULT_THINKING_LEVEL]);
    expect(__getLastAppliedThinkingLevelForTests()).toBe(DEFAULT_THINKING_LEVEL);
  });

  it("respects a user override: does not re-apply xhigh when the user lowered it", () => {
    const fake = makeFakePi("off");

    // First call: fresh session, we set xhigh.
    applyGatewayDefaultThinkingLevel(fake.pi);
    expect(fake.level).toBe(DEFAULT_THINKING_LEVEL);

    // Simulate the user typing /thinking medium.
    (fake.pi as unknown as { setThinkingLevel: (l: Level) => void }).setThinkingLevel("medium");
    // ...which is treated as an external change. Clear the recorded internal
    // applies so we can assert the helper does not call setThinkingLevel again.
    const beforeCallCount = fake.calls.length;

    // Second call (e.g. next model_select fires): helper must not override.
    const applied = applyGatewayDefaultThinkingLevel(fake.pi);

    expect(applied).toBe(false);
    expect(fake.level).toBe("medium");
    // No *additional* setThinkingLevel from the helper.
    expect(fake.calls.length).toBe(beforeCallCount);
  });

  it("re-applies the default when the current level still matches what we set", () => {
    const fake = makeFakePi("off");
    applyGatewayDefaultThinkingLevel(fake.pi);
    // Second call with no external change — still safe to re-apply (idempotent).
    const applied = applyGatewayDefaultThinkingLevel(fake.pi);
    expect(applied).toBe(true);
    expect(fake.level).toBe(DEFAULT_THINKING_LEVEL);
  });

  it("treats 'state reset' (e.g. session_shutdown) as a fresh slate", () => {
    const fake1 = makeFakePi("off");
    applyGatewayDefaultThinkingLevel(fake1.pi);

    // Simulate the user overriding, then the session ending.
    (fake1.pi as unknown as { setThinkingLevel: (l: Level) => void }).setThinkingLevel("low");
    __resetThinkingLevelStateForTests();

    // A new session starts with its own initial level. Helper should set xhigh again.
    const fake2 = makeFakePi("medium");
    const applied = applyGatewayDefaultThinkingLevel(fake2.pi);
    expect(applied).toBe(true);
    expect(fake2.level).toBe(DEFAULT_THINKING_LEVEL);
  });
});
