/* SPDX-License-Identifier: Apache-2.0 */
/** Tiny runtime routing summary: one priority rule plus disabled capability owners. */
import type { CustomMessageEntry } from "@earendil-works/pi-coding-agent";
import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import {
  type ActiveContextSession,
  shouldInjectOnce,
} from "../../../lib/common/session/inject-once.ts";

export const SF_PI_ROUTING_ENTRY_TYPE = "sf-pi-routing-summary";
export const SF_PI_ROUTING_OPEN_TAG = "<sf_pi_routing>";
export const SF_PI_ROUTING_CLOSE_TAG = "</sf_pi_routing>";

const CAPABILITY_LABELS: Record<string, string> = {
  "sf-agentscript": "Agentforce Agent Script authoring, preview, eval, and lifecycle",
  "sf-apex": "Apex lifecycle planning, diagnostics, logs, probes, and tests",
  "sf-browser": "Salesforce Setup and Lightning UI automation",
  "sf-code-analyzer": "Salesforce static analysis and ApexGuru",
  "sf-data-explorer": "read-only SOQL, SOSL, and Data 360 exploration",
  "sf-data360": "Data 360 connect, prepare, harmonize, segment, activate, query, and observe",
  "sf-devbar": "Salesforce environment and org status",
  "sf-docs": "official Salesforce documentation retrieval",
  "sf-guardrail": "Salesforce-aware safety mediation",
  "sf-herdr": "Salesforce Herdr workflow lane planning",
  "sf-lsp": "Salesforce language diagnostics",
  "sf-lwc": "Lightning Web Component inspection, diagnostics, and Jest tests",
  "sf-skills": "external Salesforce skill management",
  "sf-slack": "Slack research and confirmed collaboration writes",
  "sf-soql": "schema-aware SOQL and SOSL lifecycle",
  "sf-tldraw": "editable Salesforce diagrams",
};

export function formatSfPiRoutingSummary(cwd: string): string {
  const disabled = SF_PI_REGISTRY.filter(
    (extension) => hasAgentCapability(extension) && !isSfPiExtensionEnabled(cwd, extension.id),
  );
  const lines = [
    SF_PI_ROUTING_OPEN_TAG,
    "Family tools perform the action. Skills are supplemental playbooks; they do not own the turn.",
    "Active tool definitions are authoritative. Mix families when the task needs it. Raw sf CLI is a fallback only.",
  ];
  if (disabled.length === 0) {
    lines.push("Disabled capability owners: none.");
  } else {
    lines.push("Disabled capability owners:");
    for (const extension of disabled) {
      const label = CAPABILITY_LABELS[extension.id] ?? extension.description;
      lines.push(`- ${extension.id} — ${label}. Enable: /sf-pi enable ${extension.id}`);
    }
  }
  lines.push(SF_PI_ROUTING_CLOSE_TAG);
  return lines.join("\n");
}

export function shouldInjectSfPiRoutingSummary(
  sessionManager: ActiveContextSession,
  summary: string,
): boolean {
  const stillFresh = (entry: CustomMessageEntry) => entry.content === summary;
  return shouldInjectOnce(sessionManager, SF_PI_ROUTING_ENTRY_TYPE, stillFresh);
}

function hasAgentCapability(extension: (typeof SF_PI_REGISTRY)[number]): boolean {
  return !!(
    extension.tools?.length ||
    extension.commands?.length ||
    extension.providers?.length ||
    extension.id === "sf-guardrail"
  );
}
