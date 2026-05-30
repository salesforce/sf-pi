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
