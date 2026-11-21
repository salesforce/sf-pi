/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Voice format classification. additional_configs is shared by the legacy
 * (flat) and nested voice formats, so it never decides the format.
 */
import { describe, expect, test } from "vitest";
import { inspectSource } from "../lib/inspect.ts";
import { buildVoiceProfile } from "../lib/voice-profile.ts";

const HEAD = `config:
  agent_name: "VoiceBot"
system:
  instructions: "Help"
`;
const TAIL = `start_agent main:
  description: "Main"
`;
const ADDITIONAL = `  additional_configs:
    endpointing_config:
      max_wait_time_ms: 1000
`;

async function syntaxOf(voiceBlock: string): Promise<string | undefined> {
  const inspect = await inspectSource(`${HEAD}modality voice:\n${voiceBlock}${TAIL}`);
  return buildVoiceProfile(inspect)?.syntax;
}

describe("voice format classification", () => {
  test("a nested block with additional_configs is nested, not mixed", async () => {
    expect(await syntaxOf(`  outbound:\n    persona_id: "example_persona"\n${ADDITIONAL}`)).toBe(
      "nested",
    );
  });

  test("a legacy block with additional_configs is legacy", async () => {
    expect(await syntaxOf(`  voice_id: "example_persona"\n${ADDITIONAL}`)).toBe("legacy");
  });

  test("additional_configs alone does not decide the format", async () => {
    expect(await syntaxOf(ADDITIONAL)).toBe("unknown");
  });

  test("a legacy field beside a nested one is mixed", async () => {
    expect(
      await syntaxOf(
        `  voice_id: "example_persona"\n  outbound:\n    persona_id: "example_persona"\n`,
      ),
    ).toBe("mixed");
  });
});
