/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tips shown on the welcome screen right column.
 *
 * Instead of hardcoding generic Pi tips, the splash surfaces commands that
 * come from sf-pi extensions that are currently active or locked. That way,
 * disabling an extension hides its tip, and new bundled extensions get
 * represented as soon as their catalog entry ships.
 *
 * Each entry is one line — keep the description short and action-oriented so
 * the user can tell what the command does without running it.
 */
import type { ExtensionHealthItem, TipItem } from "./types.ts";

/**
 * Curated per-extension tip. The `name` matches what `discoverExtensionHealth`
 * returns (DISPLAY_NAME_OVERRIDES map or the SF_PI_REGISTRY name minus `SF `).
 *
 * Keep descriptions action-oriented — they should read as "this command
 * does X" rather than a feature list.
 */
const EXTENSION_TIPS: Record<string, TipItem[]> = {
  "Pi Manager": [
    {
      command: "/sf-pi",
      description: "browse, enable, and configure sf-pi extensions",
    },
  ],
  DevBar: [
    {
      command: "/sf-org",
      description: "show the current org, CLI version, and connection status",
    },
  ],
  "LLM Gateway": [
    {
      command: "/sf-llm-gateway-internal",
      description: "pick a model, view monthly usage, refresh discovery",
    },
  ],
  LSP: [
    {
      command: "/sf-lsp",
      description: "run live Apex / LWC / Agent Script diagnostics on save",
    },
  ],
  Slack: [
    {
      command: "/sf-slack",
      description: "check Slack auth and search workspace messages",
    },
  ],
  "Skills HUD": [
    {
      command: "/sf-skills",
      description: "toggle the live skills panel and inspect active skills",
    },
  ],
  Welcome: [
    {
      command: "/sf-welcome",
      description: "re-show this splash screen at any time",
    },
  ],
};

/**
 * Build the tips list for the welcome screen.
 *
 * Behavior:
 * - Only tips from extensions that are `active` or `locked` are included.
 * - Disabled extensions are skipped so the panel stays relevant to what the
 *   user actually has loaded.
 * - Unknown extensions (no entry in EXTENSION_TIPS) are ignored — better to
 *   ship a new tip with the extension than dump generic placeholders.
 *
 * The generic Pi tips (`/`, `!`, `Shift+Tab`) are intentionally not included.
 * Those are Pi built-ins users learn elsewhere, and repeating them on every
 * splash distracts from the Salesforce-specific commands.
 */
export function buildTipsForActiveExtensions(
  extensionHealth: ReadonlyArray<ExtensionHealthItem>,
): TipItem[] {
  const tips: TipItem[] = [];

  for (const ext of extensionHealth) {
    if (ext.status === "disabled") continue;
    const extTips = EXTENSION_TIPS[ext.name];
    if (!extTips) continue;
    for (const tip of extTips) {
      tips.push(tip);
    }
  }

  return tips;
}
