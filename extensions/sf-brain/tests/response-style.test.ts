/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  applyGatewayGpt6ResponseStyle,
  GATEWAY_GPT6_RESPONSE_STYLE_SECTION,
} from "../lib/response-style.ts";

describe("Gateway GPT-6 response style", () => {
  it("adds a stable prompt section for the exact Gateway GPT-6 Sol model", () => {
    const options = { sections: { other_guidance: "Keep existing guidance." } };

    applyGatewayGpt6ResponseStyle(options, {
      provider: "sf-llm-gateway",
      id: "gpt-6-sol",
    });
    const guidance = (options.sections as Record<string, string>)[
      GATEWAY_GPT6_RESPONSE_STYLE_SECTION
    ];
    expect(guidance).toContain("substantive questions");
    expect(guidance).toContain("concrete example");
    expect(guidance).toContain("relevant trade-offs");
    expect(guidance).toContain("explicit requests for brevity");
    expect(options.sections.other_guidance).toBe("Keep existing guidance.");
  });

  it.each([
    { provider: "sf-llm-gateway", id: "gpt-5.6-sol" },
    { provider: "openai", id: "gpt-6-sol" },
    { provider: "sf-llm-gateway", id: "gpt-6-luna" },
    undefined,
  ])("leaves unrelated models unchanged: %o", (model) => {
    const options = { sections: { other_guidance: "Keep existing guidance." } };

    applyGatewayGpt6ResponseStyle(options, model);

    expect(options.sections).toEqual({ other_guidance: "Keep existing guidance." });
  });

  it("removes its own guidance on a model switch without affecting other sections", () => {
    const options = { sections: { other_guidance: "Keep existing guidance." } };

    applyGatewayGpt6ResponseStyle(options, { provider: "sf-llm-gateway", id: "gpt-6-sol" });
    expect(options.sections).toHaveProperty(GATEWAY_GPT6_RESPONSE_STYLE_SECTION);

    applyGatewayGpt6ResponseStyle(options, { provider: "sf-llm-gateway", id: "gpt-5.6-sol" });
    expect(options.sections).toEqual({ other_guidance: "Keep existing guidance." });
  });
});
