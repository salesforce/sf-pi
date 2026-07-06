/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Just-in-time Salesforce browser guidance.
 *
 * Keep this concise: detailed browser command syntax belongs to agent-browser's
 * own skill, while SF Browser contracts focus on Salesforce UI behavior.
 */

export const SALESFORCE_BROWSER_GUIDANCE = [
  "SF Browser is experimental developer-assistive automation for Salesforce UI last-mile work; it is not a stable Salesforce UI automation contract.",
  "Use Salesforce APIs first for setup and verification. Use the browser for UI-only gaps.",
  "Run sf_browser_snapshot before acting. Re-snapshot after clicks, saves, modal opens, navigation, tab switches, or Lightning rerenders; refs are short-lived.",
  "Prefer refs from the latest snapshot. If ref-based tools are insufficient, direct agent-browser commands are available for the long tail and are mediated by SF Guardrail when run through Pi.",
  "For Salesforce lookup/combobox controls: fill the visible input, wait for options, snapshot, then click the desired option.",
  "For Setup pages, prefer curated Setup Destinations over search-and-click navigation when the target path is known.",
  "After deep-link navigation or opening a Setup Destination, use sf_browser_wait with lightning='navigation-ready'; use app-ready for in-page Lightning rerenders.",
  "Capture Browser Evidence with artifact mode for batches and thumbnail mode when the model should inspect the current screen. Keep dismissOverlays enabled unless the overlay is the subject of the evidence.",
].join("\n");

export const STALE_REF_HINT =
  "Salesforce hint: refs are short-lived. After clicks, saves, modal opens, navigation, or Lightning rerenders, run sf_browser_snapshot before reusing refs.";

export const RAW_AGENT_BROWSER_ESCAPE_HATCH =
  "For advanced browser work outside SF Browser's hot path, use direct agent-browser commands; SF Guardrail mediates those shell commands when run through Pi.";
