/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-multiframework — skill-first guidance for Salesforce React UI Bundles.
 *
 * V1 intentionally registers no LLM tool. Multi-Framework implementation still
 * uses normal Pi file edits plus the existing sf-pi lifecycle tools:
 * sf_apex, sf_soql, sf_browser, code_analyzer, and sf_lwc for adjacent LWC
 * comparison. This extension contributes a command, catalog entry, and bundled
 * progressive-disclosure skill.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
  type SfPiCommandAction,
  formatHelpFromActions,
  getFirstTokenCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";

const EXTENSION_ID = "sf-multiframework";
const COMMAND_NAME = "sf-multiframework";

type MultiFrameworkAction = "status" | "checklist" | "experience" | "help";

const ACTIONS: SfPiCommandAction<MultiFrameworkAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Explain the extension boundary and recommended workflow handoffs.",
    group: "Reference",
  },
  {
    value: "checklist",
    label: "Show build checklist",
    description: "Show the Multi-Framework React UI Bundle implementation checklist.",
    group: "Reference",
  },
  {
    value: "experience",
    label: "Show Experience runbook",
    description: "Show the public/authenticated Experience Cloud route checklist.",
    group: "Reference",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage.",
    group: "Reference",
  },
];

export default function sfMultiFramework(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, EXTENSION_ID)) return;

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Multi-Framework — React UI Bundle guidance and Experience runbooks",
    getArgumentCompletions: (prefix) => getFirstTokenCompletionsFromActions(ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const token = args.trim().split(/\s+/).filter(Boolean)[0];
        const action = token
          ? (resolveAction(ACTIONS, token) ?? (token.toLowerCase() as MultiFrameworkAction))
          : "status";
        await handleAction(ctx, action);
      });
    },
  });
}

async function handleAction(
  ctx: ExtensionCommandContext,
  action: MultiFrameworkAction | string,
): Promise<void> {
  if (action === "status") {
    await emit(ctx, "SF Multi-Framework status", renderStatus(), "info");
    return;
  }
  if (action === "checklist") {
    await emit(ctx, "SF Multi-Framework checklist", renderChecklist(), "info");
    return;
  }
  if (action === "experience") {
    await emit(ctx, "SF Multi-Framework Experience runbook", renderExperienceRunbook(), "info");
    return;
  }
  await emit(ctx, "SF Multi-Framework help", renderHelp(), "info");
}

async function emit(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: InfoPanelSeverity,
): Promise<void> {
  await openInfoPanel(ctx, { title, body, severity });
}

function renderStatus(): string {
  return [
    "SF Multi-Framework is a skill-first extension for React UI Bundles on Salesforce.",
    "",
    "V1 registers no native LLM tool. Use normal Pi file edits plus existing sf-pi tools:",
    "- sf_apex for Apex REST, logs, Anonymous Apex probes, and targeted tests",
    "- sf_soql for schema/query validation and access checks",
    "- sf_browser for last-mile Salesforce UI and Experience evidence",
    "- code_analyzer for static analysis",
    "- sf_lwc only for LWC comparison or adjacent LWC work",
    "",
    "For agent guidance, use the bundled skill `sf-multiframework`.",
  ].join("\n");
}

function renderChecklist(): string {
  return [
    "Core checklist:",
    "1. Confirm API v67.0+, Node 22+, and @salesforce/plugin-ui-bundle-dev.",
    "2. Choose template command deliberately: `sf template generate ui-bundle` for existing projects, `sf template generate project` for full generated app scaffolds.",
    "3. Use @salesforce/platform-sdk for Salesforce API calls; do not raw-fetch Salesforce endpoints.",
    "4. Keep SPA fallback in ui-bundle.json and build to the configured outputDir.",
    "5. Prefer `tsc --noEmit && vite build` to avoid deployable TypeScript build artifacts in the bundle root.",
    "6. For CustomApplication, deploy companion applications/*.app-meta.xml and grant app access.",
    "7. For Experience, deploy/publish digitalExperienceConfigs, digitalExperiences, networks, sites, and the UI Bundle together.",
  ].join("\n");
}

function renderExperienceRunbook(): string {
  return [
    "Experience Cloud checklist:",
    "1. Verify generated content.json uses contentBody.appContainer=true and contentBody.appSpace=c__<DeveloperName>.",
    "2. Publish the site and verify the React app-container URL, not only the underlying vforcesite URL.",
    "3. For public routes, grant guest Apex access to curated endpoints only; avoid broad guest object access.",
    "4. For auth pages, grant guest Apex access to login/forgot-password endpoints used by the template.",
    "5. For external users, clone a standard external profile into an app-specific profile, add the cloned profile to networkMemberGroups, link User.ContactId, ensure the Account owner has a role, and assign app permission sets.",
    "6. Decide platform sharing vs Apex façade. If using a façade, derive ContactId server-side and filter/validate every read and mutation by that Contact.",
  ].join("\n");
}

function renderHelp(): string {
  return formatHelpFromActions(ACTIONS, "sf-multiframework");
}
