/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for the non-configurable SF LLM Gateway model-family policy. */
import { describe, expect, it } from "vitest";
import { isGatewayModelIdAllowed, gatewayModelPolicyRefusal } from "../lib/model-policy.ts";

describe("SF LLM Gateway model-family policy", () => {
  it.each([
    "grok-4.6",
    "grok-4.7",
    "GROK-5",
    "xai/grok-4.7",
    "xai/any-model",
    "my-grok-alias",
    "grok-codex-preview",
  ])("refuses xAI Grok model id %s", (id) => {
    expect(isGatewayModelIdAllowed(id)).toBe(false);
  });

  it.each(["claude-opus-5-5", "gpt-6-sol", "gemini-3-pro", "deepseek-v4", "example-model"])(
    "allows non-xAI model id %s",
    (id) => {
      expect(isGatewayModelIdAllowed(id)).toBe(true);
    },
  );

  it("explains the refusal without suggesting a way to re-enable it", () => {
    const message = gatewayModelPolicyRefusal("grok-4.7");
    expect(message).toContain("grok-4.7");
    expect(message).toContain("SF LLM Gateway");
    expect(message).not.toMatch(/setting|enable|override/i);
  });
});
