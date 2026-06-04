/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Diagnostics for browser-process launch failures below agent-browser.
 *
 * SF Browser does not change launch behavior here; it only recognizes common
 * Chrome/Chromium startup failures so users get an actionable recovery path.
 */

const BROWSER_LAUNCH_FAILURE_PATTERNS: RegExp[] = [
  /DevToolsActivePort/i,
  /requires the chromium snap/i,
  /failed to launch(?: the)? (?:browser|chrome|chromium)(?: process)?/i,
  /(?:chrome|chromium).*exited early/i,
  /browser process.*(?:exited|closed)/i,
  /no usable sandbox|setuid sandbox|without --no-sandbox/i,
  /failed to move to new namespace/i,
  /cannot open display|missing x server|no DISPLAY environment variable/i,
  /\/dev\/shm|disable-dev-shm-usage/i,
];

export const BROWSER_LAUNCH_RECOVERY =
  "The underlying browser could not launch. In containers or CI, set AGENT_BROWSER_EXECUTABLE_PATH to a working Chrome/Chromium executable and set AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage. You can also run agent-browser install, then /sf-browser doctor to verify agent-browser itself is installed.";

export function isBrowserLaunchFailure(message: string): boolean {
  return BROWSER_LAUNCH_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}
