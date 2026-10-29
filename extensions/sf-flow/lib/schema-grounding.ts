/* SPDX-License-Identifier: Apache-2.0 */
/** Live adapters that bind Flow schema rules to one Salesforce session. */

import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { createSchemaCatalog } from "../../../lib/common/sf-schema/index.ts";
import type { FlowAnalysis, FlowFinding } from "./types.ts";
import {
  FLOW_SCHEMA_RULE_IDS,
  runFlowSchemaRules,
  type FlowSchemaContext,
  type FlowSchemaResult,
  type FlowSubflowContract,
} from "./schema-rules.ts";

const FLOW_API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;

export function liveSchemaContext(session: SalesforceSession): FlowSchemaContext {
  return {
    catalog: createSchemaCatalog(session),
    subflow: (apiName) => describeSubflowContract(session, apiName),
  };
}

async function describeSubflowContract(
  session: SalesforceSession,
  apiName: string,
): Promise<FlowSubflowContract> {
  if (!FLOW_API_NAME.test(apiName)) return { exists: false, inputs: [] };
  const definition = await session.query<{ ActiveVersionId?: string; LatestVersionId?: string }>({
    soql: `SELECT ActiveVersionId, LatestVersionId FROM FlowDefinitionView WHERE ApiName = '${apiName}' LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  const record = definition.records[0];
  if (!record) return { exists: false, inputs: [] };
  const versionId = record.ActiveVersionId ?? record.LatestVersionId;
  if (!versionId) return { exists: true, inputs: [] };
  const response = await session.request<{
    Metadata?: {
      variables?: Array<{
        name?: string;
        dataType?: string;
        isCollection?: boolean;
        isInput?: boolean;
      }>;
    };
  }>({ method: "GET", path: `/tooling/sobjects/Flow/${versionId}` });
  if (response.status >= 400) return { exists: true, inputs: [] };
  return {
    exists: true,
    inputs: (response.body.Metadata?.variables ?? [])
      .filter((variable) => variable.isInput && typeof variable.name === "string")
      .map((variable) => ({
        name: variable.name as string,
        data_type: variable.dataType,
        is_collection: variable.isCollection === true,
      })),
  };
}

/** Merge org-schema findings into a local analysis, keeping summary and coverage honest. */
export function mergeSchemaFindings(
  analysis: FlowAnalysis,
  schema: FlowSchemaResult,
): FlowAnalysis {
  const findings: FlowFinding[] = [...analysis.findings, ...schema.findings].sort(
    (left, right) => left.line - right.line || left.column - right.column,
  );
  const summary = { ...analysis.summary };
  for (const finding of schema.findings) summary[finding.severity] += 1;
  const skipped = schema.truncated
    ? [
        ...analysis.coverage.skipped,
        {
          id: "schema-objects",
          reason: "object describe limit reached; remaining objects unchecked",
        },
      ]
    : analysis.coverage.skipped;
  return {
    ...analysis,
    findings,
    summary,
    status: analysis.status === "failed" ? "failed" : findings.length ? "findings" : "clean",
    coverage: { ran: [...analysis.coverage.ran, ...FLOW_SCHEMA_RULE_IDS], skipped },
  };
}

export async function groundAnalysis(
  analysis: FlowAnalysis,
  source: string,
  context: FlowSchemaContext,
): Promise<{ analysis: FlowAnalysis; schema: FlowSchemaResult }> {
  if (analysis.status === "failed") {
    return { analysis, schema: { findings: [], objects: [], unresolved: [], truncated: false } };
  }
  const schema = await runFlowSchemaRules(source, context);
  return { analysis: mergeSchemaFindings(analysis, schema), schema };
}
