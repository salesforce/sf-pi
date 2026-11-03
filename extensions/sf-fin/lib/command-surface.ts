/* SPDX-License-Identifier: Apache-2.0 */
import type { SfPiCommandAction } from "../../../lib/common/command-actions.ts";
import { COMMAND_NAME, ENV_REGION, ENV_TOKEN, PROVIDER_NAME } from "./types.ts";

export type SfFinCommandAction = "connect" | "disconnect" | "status" | "doctor" | "help";

export const SF_FIN_ACTIONS: SfPiCommandAction<SfFinCommandAction>[] = [
  {
    value: "connect",
    label: "Connect",
    description: `Prepare native /login ${PROVIDER_NAME} to save the region and a masked personal API token.`,
    group: "Connection",
  },
  {
    value: "disconnect",
    label: "Disconnect",
    description:
      "Prepare native logout for the saved credential. Environment variables are untouched.",
    group: "Connection",
  },
  {
    value: "status",
    label: "Show status",
    description: "Show cached credential, region, and last doctor result (no network).",
    group: "Connection",
  },
  {
    value: "doctor",
    label: "Run doctor",
    description: "Read-only check: Fin CLI version and `intercom me` with the saved credential.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Show command usage and setup guidance.",
    group: "Reference",
  },
];

export function renderHelp(): string {
  return [
    "# SF Fin",
    "",
    "SF Fin connects SF Pi to a Fin (formerly Intercom) workspace through the user's installed Fin CLI.",
    "",
    "Commands:",
    `- \`/${COMMAND_NAME}\` — open the SF Pi Manager detail page.`,
    `- \`/${COMMAND_NAME} connect\` — prepare native \`/login ${PROVIDER_NAME}\`.`,
    `- \`/${COMMAND_NAME} disconnect\` — prefill native logout for the saved credential.`,
    `- \`/${COMMAND_NAME} status\` — cached status; no network.`,
    `- \`/${COMMAND_NAME} doctor\` — read-only check of the CLI and credential.`,
    "",
    "Setup:",
    "1. Install the Fin CLI: `npm install -g @intercom/cli`.",
    "2. In Fin, open Settings → Personal → API tokens and create a token.",
    `3. Run \`/login ${PROVIDER_NAME}\`, choose the region from your workspace URL, and paste the token into the masked prompt.`,
    `4. Run \`/${COMMAND_NAME} doctor\`.`,
    "",
    "Credential boundary:",
    `- Pi owns persistence; \`/logout ${PROVIDER_NAME}\` removes the saved credential.`,
    "- The token reaches the CLI only through its child-process environment, with an SF Pi-private CLI config directory.",
    `- \`${ENV_TOKEN}\` and \`${ENV_REGION}\` remain automation fallbacks.`,
  ].join("\n");
}
