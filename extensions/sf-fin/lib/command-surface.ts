/* SPDX-License-Identifier: Apache-2.0 */
import type { SfPiCommandAction } from "../../../lib/common/command-actions.ts";
import { COMMAND_NAME, ENV_REGION, ENV_TOKEN, PROVIDER_NAME } from "./types.ts";

export type SfFinCommandAction =
  | "connect"
  | "disconnect"
  | "status"
  | "doctor"
  | "install"
  | "debug"
  | "debug-on"
  | "debug-off"
  | "sdk"
  | "help";

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
    description: "Show cached credential, region, CLI, and last doctor result (no network).",
    group: "Connection",
  },
  {
    value: "install",
    label: "Install or update Fin CLI",
    description:
      "Plan, confirm, then run `npm install -g @intercom/cli@<exact version>` and verify the result.",
    group: "Setup",
  },
  {
    value: "doctor",
    label: "Run doctor",
    description: "Live read-only checks: Node, Fin CLI, version, credential, and workspace.",
    group: "Diagnostics",
  },
  {
    value: "debug",
    label: "Show debug bundle",
    description: "Redacted support bundle: versions, paths, env names, last CLI error.",
    group: "Diagnostics",
  },
  {
    value: "debug-on",
    label: "Arm verbose trace",
    description:
      "Trace the next doctor run with the CLI's --verbose output, scrubbed to a private file.",
    group: "Diagnostics",
  },
  {
    value: "debug-off",
    label: "Disarm verbose trace",
    description: "Turn verbose tracing off before it runs.",
    group: "Diagnostics",
  },
  {
    value: "sdk",
    label: "Fin SDK manifest",
    description:
      "Summarize procedures, workflows, guidance, and connectors. Enables the Fin SDK on first use.",
    group: "Fin as code",
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
    "SF Fin connects SF Pi to a Fin (formerly Intercom) workspace through the Fin CLI.",
    "",
    "Commands:",
    `- \`/${COMMAND_NAME}\` — open the SF Pi Manager detail page.`,
    `- \`/${COMMAND_NAME} connect\` / \`disconnect\` — prepare native \`/login\` / \`/logout ${PROVIDER_NAME}\`.`,
    `- \`/${COMMAND_NAME} status\` — cached status; no network.`,
    `- \`/${COMMAND_NAME} install [version]\` — install or update the Fin CLI with global npm after confirmation.`,
    `- \`/${COMMAND_NAME} doctor\` — live read-only checks.`,
    `- \`/${COMMAND_NAME} debug\` — redacted support bundle.`,
    `- \`/${COMMAND_NAME} debug on [runs]\` / \`debug off\` — arm or disarm a one-shot verbose trace.`,
    `- \`/${COMMAND_NAME} sdk [manifest|download]\` — Fin-as-code reads; enables the Fin SDK on first use.`,
    `- \`/${COMMAND_NAME} sdk validate <procedure.yaml>\` — local schema and draft-rule check.`,
    `- \`/${COMMAND_NAME} sdk upload <procedure.yaml>\` — upload an unpublished draft (round-trip verified).`,
    `- \`/${COMMAND_NAME} sdk upload_simulations <simulations.yaml>\` — upload a simulation_set (tests with an id update; without one, add).`,
    `- \`/${COMMAND_NAME} sdk simulate <procedure_id>\` — generate and run simulations (live procedures only).`,
    `- \`/${COMMAND_NAME} sdk publish|pause <procedure_id>\` — set a procedure live or paused after confirmation.`,
    "",
    "Setup:",
    `1. \`/${COMMAND_NAME} install\` (or \`npm install -g @intercom/cli\`).`,
    "2. In Fin, open Settings → Personal → API tokens and create a token.",
    `3. \`/login ${PROVIDER_NAME}\`: choose the region from your workspace URL, then paste the token into the masked prompt.`,
    `4. \`/${COMMAND_NAME} doctor\`.`,
    "",
    "Credential boundary:",
    `- Pi owns persistence; \`/logout ${PROVIDER_NAME}\` removes the saved credential.`,
    "- The token reaches the CLI only through its child-process environment, with an SF Pi-private CLI config directory.",
    `- \`${ENV_TOKEN}\` and \`${ENV_REGION}\` remain automation fallbacks.`,
  ].join("\n");
}
