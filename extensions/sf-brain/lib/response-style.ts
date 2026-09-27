/* SPDX-License-Identifier: Apache-2.0 */
/** Model-scoped chat guidance, kept separate from the persistent constitution. */
export const GATEWAY_GPT6_RESPONSE_STYLE_SECTION = "sf_pi_gpt6_response_style";

const GATEWAY_GPT6_RESPONSE_STYLE =
  "For substantive questions, lead with the answer, then develop the explanation with a concrete example and relevant trade-offs. " +
  "Do not stop at a summary. Keep simple answers short and honor explicit requests for brevity.";

export function applyGatewayGpt6ResponseStyle(
  options: { sections: Record<string, string> },
  model: { provider: string; id: string } | undefined,
): void {
  if (model?.provider === "sf-llm-gateway" && model.id === "gpt-6-sol") {
    options.sections[GATEWAY_GPT6_RESPONSE_STYLE_SECTION] = GATEWAY_GPT6_RESPONSE_STYLE;
  } else {
    // Pi removes a missing named section from the transcript on the next turn.
    delete options.sections[GATEWAY_GPT6_RESPONSE_STYLE_SECTION];
  }
}
