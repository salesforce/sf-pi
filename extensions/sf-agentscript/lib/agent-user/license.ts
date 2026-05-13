/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Check whether the org is provisioned with an Agentforce license.
 *
 * The agent-user-setup doc names `PID_DigitalAgent` as the canonical
 * license — that's accurate for many production orgs but NOT all. Newer
 * dev / sandbox orgs commonly ship with one of:
 *   - PID_DigitalAgent              (legacy production)
 *   - EinsteinGPTCopilotPsl         ("Agentforce (Default)")
 *   - AgentforceServiceAgentUserPsl ("Agentforce Service Agent User")
 *   - AgentPlatformBuilderPsl       ("Agent platform builder")
 *
 * We accept any of those as evidence the org has Agentforce. We also avoid
 * `PermissionSetLicenseAssignment` (the doc's preferred query) because
 * some org types refuse the query outright with "sObject type ... is not
 * supported"; the simpler `PermissionSetLicense` query works everywhere.
 *
 * Read-only. One SOQL hit.
 *
 * Doc: skills/sf-ai-agentscript/references/agent-user-setup.md.
 */

import type { Connection } from "@salesforce/core";

export interface DigitalAgentLicenseCheck {
  /** True when the org has at least one active Agentforce-family PSL. */
  ok: boolean;
  /** DeveloperNames of the matching active PSLs (when found). */
  found_licenses?: string[];
  /** Human-readable detail surfaced to the LLM. */
  detail: string;
}

/**
 * Known DeveloperNames of PermissionSetLicense rows that indicate the org
 * is Agentforce-enabled. Order doesn't matter — we accept any active one.
 */
const AGENTFORCE_LICENSE_NAMES = [
  "PID_DigitalAgent",
  "EinsteinGPTCopilotPsl",
  "AgentforceServiceAgentUserPsl",
  "AgentPlatformBuilderPsl",
  "AgentforceServiceAgentBuilderPsl",
] as const;

export async function getDigitalAgentLicense(conn: Connection): Promise<DigitalAgentLicenseCheck> {
  const inClause = AGENTFORCE_LICENSE_NAMES.map((n) => `'${n}'`).join(",");
  const soql =
    `SELECT DeveloperName, Status FROM PermissionSetLicense ` +
    `WHERE DeveloperName IN (${inClause}) AND Status='Active'`;
  try {
    const r = await conn.query<{ DeveloperName: string; Status: string }>(soql);
    if (r.records.length === 0) {
      return {
        ok: false,
        detail:
          `No active Agentforce license found in this org (checked: ` +
          `${AGENTFORCE_LICENSE_NAMES.join(", ")}). Agentforce features ` +
          `(publish / activate / preview) require one. An admin must ` +
          `provision the license before any agent-user setup can proceed.`,
      };
    }
    const names = r.records.map((row) => row.DeveloperName);
    return {
      ok: true,
      found_licenses: names,
      detail: `Active Agentforce license(s) found: ${names.join(", ")}.`,
    };
  } catch (err) {
    // Defensive: if the org's API doesn't expose PermissionSetLicense,
    // we treat the check as unverifiable (ok=false, detail says so) so
    // the surrounding flow stops and surfaces a clear message rather
    // than silently passing.
    return {
      ok: false,
      detail:
        `License check failed: ${err instanceof Error ? err.message : String(err)}. ` +
        `Cannot confirm whether this org has Agentforce. Skipping further checks.`,
    };
  }
}
