/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { confirmDecision } from "../lib/hitl.ts";

type ConfirmContext = Parameters<typeof confirmDecision>[0];

function ctxWithSelection(
  selection: string | undefined,
  hasUI = true,
  onChoices?: (choices: string[]) => void,
): ConfirmContext {
  return {
    hasUI,
    ui: {
      select: async (_title: string, choices: string[]) => {
        onChoices?.(choices);
        return selection;
      },
      notify: () => undefined,
      setStatus: () => undefined,
    },
  } as unknown as ConfirmContext;
}

describe("confirmDecision", () => {
  const base = {
    title: "Test gate",
    detail: "Dangerous command: rm -rf tmp",
    timeoutMs: 120000,
    escapeHatchEnv: "SF_GUARDRAIL_ALLOW_HEADLESS_TEST",
  };

  it("allows once when selected", async () => {
    await expect(confirmDecision(ctxWithSelection("Allow once"), base)).resolves.toEqual({
      outcome: "allow_once",
    });
  });

  it("allows for the current session when selected", async () => {
    const result = await confirmDecision(ctxWithSelection("Allow for this session"), base);
    expect(result.outcome).toBe("allow_session");
  });

  it("returns actionable block reason when blocked", async () => {
    const result = await confirmDecision(ctxWithSelection("Block"), base);
    expect(result.outcome).toBe("block");
    if (result.outcome === "block") {
      expect(result.reason).toContain("Test gate");
      expect(result.reason).toContain("/sf-guardrail audit");
    }
  });

  it("omits the session approval option when the envelope is allow-once only", async () => {
    let renderedChoices: string[] = [];
    await confirmDecision(
      ctxWithSelection("Allow once", true, (choices) => (renderedChoices = choices)),
      {
        ...base,
        allowSession: false,
      },
    );
    expect(renderedChoices).toEqual(["Allow once", "Block"]);
  });

  it("headless blocks without escape hatch", async () => {
    delete process.env.SF_GUARDRAIL_ALLOW_HEADLESS_TEST;
    const result = await confirmDecision(ctxWithSelection(undefined, false), base);
    expect(result.outcome).toBe("headless_block");
  });

  it("headless passes with escape hatch", async () => {
    process.env.SF_GUARDRAIL_ALLOW_HEADLESS_TEST = "1";
    try {
      const result = await confirmDecision(ctxWithSelection(undefined, false), base);
      expect(result.outcome).toBe("headless_pass");
    } finally {
      delete process.env.SF_GUARDRAIL_ALLOW_HEADLESS_TEST;
    }
  });
});
