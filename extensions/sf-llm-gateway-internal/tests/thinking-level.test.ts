/* SPDX-License-Identifier: Apache-2.0 */
/** Deletion guards for capability-only Gateway thinking support. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { setDefaultModelSelection } from "../lib/pi-settings.ts";

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source(relativePath: string): string {
  return readFileSync(path.join(extensionRoot, relativePath), "utf8");
}

describe("Gateway thinking authority", () => {
  it.each(["low", undefined])(
    "preserves Pi's %s thinking setting while changing the default model",
    (thinkingLevel) => {
      const settings: Record<string, unknown> = {};
      if (thinkingLevel !== undefined) settings.defaultThinkingLevel = thinkingLevel;

      setDefaultModelSelection(settings, "sf-llm-gateway-internal", "gpt-5.6-sol");

      expect(settings.defaultProvider).toBe("sf-llm-gateway-internal");
      expect(settings.defaultModel).toBe("gpt-5.6-sol");
      if (thinkingLevel === undefined) {
        expect(settings).not.toHaveProperty("defaultThinkingLevel");
      } else {
        expect(settings.defaultThinkingLevel).toBe(thinkingLevel);
      }
    },
  );

  it("never mutates Pi's active thinking level", () => {
    expect(source("index.ts")).not.toContain("setThinkingLevel(");
  });

  it("does not keep passive thinking-default state or test-only accessors", () => {
    const index = source("index.ts");
    const config = source("lib/config.ts");
    expect(index).not.toContain("lastAppliedThinkingLevel");
    expect(index).not.toContain("applyGatewayDefaultThinkingLevel");
    expect(index).not.toContain("__getLastAppliedThinkingLevelForTests");
    expect(index).not.toContain("__resetThinkingLevelStateForTests");
    expect(config).not.toContain("DEFAULT_THINKING_LEVEL");
    expect(config).not.toContain("OFF_DEFAULT_THINKING_LEVEL");
    expect(config).not.toContain("previousThinkingLevel");
  });

  it("does not write Pi's defaultThinkingLevel setting", () => {
    expect(source("index.ts")).not.toMatch(/settings\.defaultThinkingLevel\s*=/u);
    expect(source("lib/migrate-gpt56-default.ts")).not.toMatch(
      /settings\.defaultThinkingLevel\s*=/u,
    );
  });
});
