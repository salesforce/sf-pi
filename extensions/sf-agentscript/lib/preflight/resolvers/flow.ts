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
import type { ActionTarget, TargetResolution, TargetResolver } from "../types.ts";

interface FlowViewRow extends Record<string, unknown> {
  ApiName?: string;
}

interface FlowVariableMetadata {
  name?: string;
  isInput?: boolean;
  isOutput?: boolean;
}

interface FlowToolingRow extends Record<string, unknown> {
  Definition?: { DeveloperName?: string };
  Metadata?: { variables?: FlowVariableMetadata[] };
}

export const flowResolver: TargetResolver = {
  schemes: ["flow"],
  metadataLabel: "Flow",
  async resolve(conn: Connection, names: readonly string[]) {
    if (names.length === 0) return new Set();
    const soql =
      `SELECT ApiName FROM FlowDefinitionView WHERE ApiName IN (${soqlInList(names)}) ` +
      `AND IsActive = true`;
    const rows = await safeQueryRecords<FlowViewRow>(conn, "/query", soql);
    if (!rows) return null;
    const found = new Set<string>();
    for (const row of rows) {
      if (typeof row.ApiName === "string") found.add(row.ApiName);
    }
    return found;
  },
  async resolveTargets(conn: Connection, targets: readonly ActionTarget[]) {
    if (targets.length === 0) return [];
    const byName = new Map<string, FlowToolingRow>();
    for (const refName of [...new Set(targets.map((target) => target.ref_name))]) {
      // Tooling API refuses Metadata queries that can return multiple rows:
      // "query qualifications must specify no more than one row". Query one
      // active Flow at a time and cache by DeveloperName so duplicate action
      // targets still only pay once.
      const soql =
        `SELECT Definition.DeveloperName, Metadata FROM Flow ` +
        `WHERE Definition.DeveloperName = '${refName.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' AND Status = 'Active' LIMIT 1`;
      const rows = await safeQueryRecords<FlowToolingRow>(conn, "/tooling/query", soql);
      if (!rows) return null;
      const row = rows[0];
      const name = row?.Definition?.DeveloperName;
      if (typeof name === "string" && !byName.has(name)) byName.set(name, row);
    }

    return targets.map((target): TargetResolution => {
      const row = byName.get(target.ref_name);
      if (!row) {
        return { status: "missing", detail: flowMissingDetail(target), reason: "missing_flow" };
      }
      const variables = row.Metadata?.variables ?? [];
      const inputs = new Set(
        variables.filter((v) => v.isInput && v.name).map((v) => v.name as string),
      );
      const outputs = new Set(
        variables.filter((v) => v.isOutput && v.name).map((v) => v.name as string),
      );
      const missingInputs = (target.input_names ?? []).filter((name) => !inputs.has(name));
      const missingOutputs = (target.output_names ?? []).filter((name) => !outputs.has(name));
      if (missingInputs.length > 0 || missingOutputs.length > 0) {
        const parts = [
          missingInputs.length ? `missing input(s): ${missingInputs.join(", ")}` : undefined,
          missingOutputs.length ? `missing output(s): ${missingOutputs.join(", ")}` : undefined,
        ].filter(Boolean);
        return {
          status: "missing",
          reason: "io_mismatch",
          detail:
            `Flow '${target.ref_name}' exists, but its active version does not match ` +
            `the Agent Script action contract (${parts.join("; ")}).`,
          data: {
            expected_inputs: target.input_names ?? [],
            expected_outputs: target.output_names ?? [],
            actual_inputs: [...inputs].sort(),
            actual_outputs: [...outputs].sort(),
          },
        };
      }
      return { status: "ok" };
    });
  },
  missingDetail(target) {
    return flowMissingDetail(target);
  },
  fixHint(name) {
    return `sf project deploy start -m Flow:${name}`;
  },
};

function flowMissingDetail(target: ActionTarget): string {
  return `Flow '${target.ref_name}' not found as an active Flow in the org.`;
}
