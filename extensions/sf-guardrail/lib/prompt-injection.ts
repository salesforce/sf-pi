/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Once-per-session guardrail-awareness kernel.
 *
 * Modeled on sf-brain: inject a short custom message on the first
 * `before_agent_start`, guarded by a session-entry check so /resume and
 * /fork inherit it instead of re-detecting.
 *
 * Users can override the bundled prompt by dropping their own file at
 * `<globalAgentDir>/sf-guardrail/SF_GUARDRAIL_PROMPT.md`. Empty/unreadable
 * overrides silently fall back to the bundled body.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUNDLED_PROMPT_PATH = path.resolve(__dirname, "..", "SF_GUARDRAIL_PROMPT.md");

export function overridePromptPath(): string {
  return globalAgentPath("sf-guardrail", "SF_GUARDRAIL_PROMPT.md");
}

export function readBundledPrompt(): string {
  return readFileSync(BUNDLED_PROMPT_PATH, "utf8").trimEnd() + "\n";
}

export function loadPrompt(): string {
  const overridePath = overridePromptPath();
  try {
    if (existsSync(overridePath)) {
      const text = readFileSync(overridePath, "utf8").trimEnd();
      if (text.length > 0) return text + "\n";
    }
  } catch {
    // Fall through to bundled.
  }
  return readBundledPrompt();
}
