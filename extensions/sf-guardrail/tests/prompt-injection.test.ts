/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Prompt injection loader tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

let configModule: typeof import("../lib/config.ts");
let promptModule: typeof import("../lib/prompt-injection.ts");

beforeEach(async () => {
  vi.resetModules();
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-prompt-agent-"));
  configModule = await import("../lib/config.ts");
  promptModule = await import("../lib/prompt-injection.ts");
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
});

describe("loadPrompt", () => {
  it("falls back to rule-derived guidance", () => {
    const config = configModule.readBundledConfig();
    config.headlessEscapeHatchEnv = "CUSTOM_GUARDRAIL_ALLOW_HEADLESS";

    const prompt = promptModule.loadPrompt(config);

    expect(prompt).toContain("<sf_guardrail>");
    expect(prompt).toContain("CUSTOM_GUARDRAIL_ALLOW_HEADLESS=1");
  });

  it("uses non-empty user override prompts", () => {
    const overridePath = promptModule.overridePromptPath();
    mkdirSync(path.dirname(overridePath), { recursive: true });
    writeFileSync(overridePath, "<sf_guardrail>custom</sf_guardrail>\n", "utf8");

    expect(promptModule.loadPrompt(configModule.readBundledConfig())).toBe(
      "<sf_guardrail>custom</sf_guardrail>\n",
    );
  });

  it("ignores empty user override prompts", () => {
    const overridePath = promptModule.overridePromptPath();
    mkdirSync(path.dirname(overridePath), { recursive: true });
    writeFileSync(overridePath, "\n", "utf8");

    const prompt = promptModule.loadPrompt(configModule.readBundledConfig());

    expect(prompt).toContain("File protection:");
  });
});
