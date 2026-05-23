/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `flow://X`.
 *
 * `FlowDefinitionView` is the canonical data-API sObject that exposes
 * the active version of every deployed Flow + ProcessBuilder. We query
 * it (not the Tooling API's `FlowDefinition`, which uses DeveloperName)
 * because invocable references resolve against the active version's
 * runtime ApiName. In orgs where Metadata API `processType=Flow` produces
 * autolaunched flows, FlowDefinitionView reports `ProcessType='Flow'`, so
 * active ApiName is the stable readiness signal.
 */

import type { Connection } from "@salesforce/core";
import { safeQueryRecords, soqlInList } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const flowResolver: TargetResolver = {
  schemes: ["flow"],
  metadataLabel: "Flow",
  async resolve(conn: Connection, names: readonly string[]) {
    if (names.length === 0) return new Set();
    const soql =
      `SELECT ApiName FROM FlowDefinitionView WHERE ApiName IN (${soqlInList(names)}) ` +
      `AND IsActive = true`;
    const rows = await safeQueryRecords<{ ApiName?: string }>(conn, "/query", soql);
    if (!rows) return null;
    const found = new Set<string>();
    for (const row of rows) {
      if (typeof row.ApiName === "string") found.add(row.ApiName);
    }
    return found;
  },
  missingDetail(target) {
    return `Flow '${target.ref_name}' not found as an active Autolaunched Flow in the org.`;
  },
  fixHint(name) {
    return `sf project deploy start -m Flow:${name}`;
  },
};
