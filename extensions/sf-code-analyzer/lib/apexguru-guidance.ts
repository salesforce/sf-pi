/* SPDX-License-Identifier: Apache-2.0 */
/** Human-safe ApexGuru setup guidance. */

export const APEXGURU_SETUP_HELP =
  "I can use SF Browser to check Scale Center / ApexGuru Insights and help enable ApexGuru if Salesforce exposes the setup option, after your approval.";

export function isApexGuruUnavailableMessage(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("apexguru") &&
    (lower.includes("not currently enabled") ||
      lower.includes("not enabled") ||
      lower.includes("eligible") ||
      lower.includes("ineligible") ||
      lower.includes("not authed"))
  );
}

export function formatApexGuruSetupRunbook(targetOrg?: string): string {
  return [
    "✨ ApexGuru Setup Check with SF Browser",
    "",
    "Purpose: check whether Salesforce Setup exposes Scale Center / Scale Insights / ApexGuru Insights, and help enable ApexGuru only if the UI clearly offers that option.",
    "",
    "Human-in-the-loop contract:",
    "- Do not open SF Browser until the user approves this workflow.",
    "- Do not click Enable, Accept, Save, or agreement controls until the user approves that specific action.",
    "- Capture Browser Evidence when no setup entry is visible, before any enablement click, and after any approved change.",
    "",
    "Suggested SF Browser steps after approval:",
    `1. Open Setup in ${targetOrg ?? "the target org"} with sf_browser_open_org(setup='setup-home').`,
    "2. Search Quick Find for Scale Center, Scale Insights, and ApexGuru Insights.",
    "3. If no destination is visible, capture evidence and stop with an explanation.",
    "4. If a destination is visible, navigate to it and capture evidence.",
    "5. If an enable or agreement action is visible, explain it and ask for explicit approval before clicking.",
    "6. After any approved enable/save, verify with code_analyzer action='apexguru' or the ApexGuru validate endpoint.",
  ].join("\n");
}

export function formatApexGuruSetupSuggestion(reason: string): string {
  return [
    "✨ ApexGuru setup needed",
    "",
    reason,
    "",
    "If this org includes Scale Center / ApexGuru Insights, SF Pi can check Salesforce Setup with SF Browser and help enable it if the option is available.",
    "Nothing was changed.",
    "",
    `Setup help: ${APEXGURU_SETUP_HELP}`,
  ].join("\n");
}
