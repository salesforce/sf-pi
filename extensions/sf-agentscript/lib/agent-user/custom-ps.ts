/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Synthesize a custom PermissionSet XML for a Service Agent's Apex class
 * access. The doc's convention is `{AgentName}_Access` — we follow it for
 * the file name + label, but we build the XML programmatically from the
 * .agent's `apex://` action targets so the PS always covers exactly what
 * the bundle declares.
 *
 * Pure function — no I/O, no Connection. Output is deterministic given
 * the same input, which is what diagnose's preview_custom_ps_xml field
 * relies on.
 */

export interface SynthesizeCustomPSInput {
  /** Used for the PS DeveloperName (`{agent}_Access`) and the description. */
  agent_name: string;
  /** Apex class names extracted from the bundle's `apex://X` targets. */
  apex_classes: readonly string[];
}

export interface SynthesizeCustomPSResult {
  /** The PS DeveloperName (the file's basename without the .meta.xml suffix). */
  developer_name: string;
  /** The PS Label as it shows in Setup. */
  label: string;
  /** The fully-rendered PermissionSet metadata XML. */
  xml: string;
}

const PS_TEMPLATE_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">`;
const PS_TEMPLATE_FOOTER = "</PermissionSet>";

export function synthesizeCustomPS(input: SynthesizeCustomPSInput): SynthesizeCustomPSResult {
  const developer_name = `${sanitizeApiName(input.agent_name)}_Access`;
  const label = `${input.agent_name} Access`;

  // Sort + de-dup so the output is stable regardless of input ordering.
  // Stable output matters for diagnose's dry-run preview.
  const classes = Array.from(new Set(input.apex_classes)).sort();

  const lines: string[] = [];
  lines.push(PS_TEMPLATE_HEADER);
  lines.push(
    `    <description>${escapeXml(`Grants access to Apex classes invoked by the ${input.agent_name} agent.`)}</description>`,
  );
  lines.push("    <hasActivationRequired>false</hasActivationRequired>");
  lines.push(`    <label>${escapeXml(label)}</label>`);
  for (const cls of classes) {
    lines.push("    <classAccesses>");
    lines.push(`        <apexClass>${escapeXml(cls)}</apexClass>`);
    lines.push("        <enabled>true</enabled>");
    lines.push("    </classAccesses>");
  }
  lines.push(PS_TEMPLATE_FOOTER);
  return {
    developer_name,
    label,
    xml: lines.join("\n") + "\n",
  };
}

/**
 * Strip characters not allowed in a Salesforce DeveloperName. Keeps
 * letters, digits, and underscores; replaces the rest with `_`. Doesn't
 * trim leading underscores (the agent's own naming convention is the
 * source of truth).
 */
function sanitizeApiName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
