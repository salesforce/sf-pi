/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Once-per-session guardrail-awareness kernel.
 *
 * Modeled on sf-brain: inject a short custom message on the first
 * `before_agent_start`, guarded by a session-entry check so /resume and
 * /fork inherit it instead of re-detecting.
 *
 * Agent guidance is generated from the effective ruleset. Users can still
 * override the generated prompt by dropping their own file at
 * `<globalAgentDir>/sf-guardrail/SF_GUARDRAIL_PROMPT.md`; empty/unreadable
 * overrides silently fall back to rule-derived guidance.
 */
import { existsSync, readFileSync } from "node:fs";

import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { readBundledConfig } from "./config.ts";
import { renderGuardrailGuidance } from "./guidance.ts";
import type { GuardrailConfig } from "./types.ts";

export function overridePromptPath(): string {
  return globalAgentPath("sf-guardrail", "SF_GUARDRAIL_PROMPT.md");
}

export function loadPrompt(config: GuardrailConfig = readBundledConfig()): string {
  const overridePath = overridePromptPath();
  try {
    if (existsSync(overridePath)) {
      const text = readFileSync(overridePath, "utf8").trimEnd();
      if (text.length > 0) return text + "\n";
    }
  } catch {
    // Fall through to bundled.
  }
  return renderGuardrailGuidance(config);
}
