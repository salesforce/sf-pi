/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded live-org grounding for Flow authoring plans. */

import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type { SfFlowParams } from "./types.ts";

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const ACTION_DETAIL_LIMIT = 5;
const SUBFLOW_DETAIL_LIMIT = 5;
export const CUSTOM_ACTION_CATEGORIES = [
  "apex",
  "flow",
  "externalService",
  "quickAction",
  "emailAlert",
  "generateAiAgentResponse",
];

export interface GroundedField {
  name: string;
  label?: string;
  type?: string;
  reference_to: string[];
}

export interface GroundedObject {
  api_name: string;
  label?: string;
  fields: GroundedField[];
  total_fields?: number;
  truncated?: boolean;
}

export interface GroundedActionSummary {
  name: string;
  label?: string;
  type?: string;
  url: string;
}

export interface GroundedAction extends GroundedActionSummary {
  description?: string;
  inputs: Array<{ name: string; type?: string; required?: boolean }>;
  outputs: Array<{ name: string; type?: string }>;
}

export interface GroundedSubflowSummary {
  api_name: string;
  label?: string;
  active_version_id?: string;
  latest_version_id?: string;
}

export interface GroundedSubflow extends GroundedSubflowSummary {
  inputs: Array<{ name: string; data_type?: string; object_type?: string; is_collection: boolean }>;
  outputs: Array<{
    name: string;
    data_type?: string;
    object_type?: string;
    is_collection: boolean;
  }>;
}

export interface AuthorGroundingResult {
  target_org: string;
  api_version?: string;
  object?: GroundedObject;
  event?: GroundedObject;
  actions: GroundedAction[];
  subflows: GroundedSubflow[];
  coverage: {
    calls: string[];
    gaps: Array<{ area: string; reason: string }>;
  };
}

export interface AuthorGroundingAdapter {
  describeObject(name: string): Promise<GroundedObject>;
  listActions(): Promise<GroundedActionSummary[]>;
  describeAction(action: GroundedActionSummary): Promise<GroundedAction>;
  listSubflows(): Promise<GroundedSubflowSummary[]>;
  describeSubflow(flow: GroundedSubflowSummary): Promise<GroundedSubflow>;
}

export async function groundAuthoringContext(
  session: SalesforceSession,
  params: SfFlowParams,
  dependencies: { adapter?: AuthorGroundingAdapter } = {},
): Promise<AuthorGroundingResult> {
  const adapter = dependencies.adapter ?? createDefaultAdapter(session);
  const limit = Math.max(1, Math.min(Math.floor(params.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
  const terms = intentTerms(params.intent, params.object, params.event);
  const result: AuthorGroundingResult = {
    target_org:
      params.target_org ?? session.target?.alias ?? session.target?.targetOrg ?? "configured org",
    api_version: session.target?.apiVersion,
    actions: [],
    subflows: [],
    coverage: { calls: [], gaps: [] },
  };

  if (params.object) {
    try {
      result.object = selectObjectFields(await adapter.describeObject(params.object), terms, limit);
      result.coverage.calls.push(`describe:${params.object}`);
    } catch (error) {
      result.coverage.gaps.push({ area: "object", reason: errorMessage(error) });
    }
  }
  if (params.event) {
    try {
      result.event = selectObjectFields(await adapter.describeObject(params.event), terms, limit);
      result.coverage.calls.push(`describe:${params.event}`);
    } catch (error) {
      result.coverage.gaps.push({ area: "event", reason: errorMessage(error) });
    }
  }

  try {
    const summaries = (await adapter.listActions())
      .map((action) => ({ action, score: matchScore(action, terms) }))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.action.name.localeCompare(right.action.name),
      )
      .slice(0, Math.min(limit, ACTION_DETAIL_LIMIT));
    result.actions = await Promise.all(
      summaries.map(({ action }) => adapter.describeAction(action)),
    );
    result.coverage.calls.push("actions:standard+custom");
  } catch (error) {
    result.coverage.gaps.push({ area: "actions", reason: errorMessage(error) });
  }

  try {
    const summaries = (await adapter.listSubflows())
      .map((flow) => ({ flow, score: matchScore(flow, terms) }))
      .filter((candidate) => candidate.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score || left.flow.api_name.localeCompare(right.flow.api_name),
      )
      .slice(0, Math.min(limit, SUBFLOW_DETAIL_LIMIT));
    result.subflows = await Promise.all(summaries.map(({ flow }) => adapter.describeSubflow(flow)));
    result.coverage.calls.push("subflows:active-or-latest");
  } catch (error) {
    result.coverage.gaps.push({ area: "subflows", reason: errorMessage(error) });
  }
  return result;
}

function createDefaultAdapter(session: SalesforceSession): AuthorGroundingAdapter {
  return {
    async describeObject(name) {
      const response = await session.request<{
        name?: string;
        label?: string;
        fields?: Array<{
          name?: string;
          label?: string;
          type?: string;
          referenceTo?: string[];
        }>;
      }>({ method: "GET", path: `/sobjects/${encodeURIComponent(name)}/describe` });
      if (response.status >= 400)
        throw new Error(`describe ${name} returned HTTP ${response.status}`);
      return {
        api_name: response.body.name ?? name,
        label: response.body.label,
        fields: (response.body.fields ?? [])
          .filter(
            (field): field is typeof field & { name: string } => typeof field.name === "string",
          )
          .map((field) => ({
            name: field.name,
            label: field.label,
            type: field.type,
            reference_to: field.referenceTo ?? [],
          })),
      };
    },
    async listActions() {
      const standard = await session.request<{ actions?: GroundedActionSummary[] }>({
        method: "GET",
        path: "/actions/standard",
      });
      if (standard.status >= 400)
        throw new Error(`standard actions returned HTTP ${standard.status}`);
      const customIndex = await session.request<Record<string, string>>({
        method: "GET",
        path: "/actions/custom",
      });
      if (customIndex.status >= 400)
        throw new Error(`custom actions returned HTTP ${customIndex.status}`);
      const custom = await Promise.all(
        CUSTOM_ACTION_CATEGORIES.filter((category) => customIndex.body[category]).map(
          async (category) =>
            collectCustomActionSummaries(customIndex.body[category], async (url) => {
              const response = await session.continueRequest<Record<string, unknown>>({
                method: "GET",
                path: url,
              });
              return response.status < 400 ? response.body : undefined;
            }),
        ),
      );
      return [...(standard.body.actions ?? []), ...custom.flat()];
    },
    async describeAction(action) {
      const response = await session.continueRequest<{
        name?: string;
        label?: string;
        type?: string;
        description?: string;
        inputs?: Array<{ name?: string; type?: string; required?: boolean }>;
        outputs?: Array<{ name?: string; type?: string }>;
      }>({ method: "GET", path: action.url });
      if (response.status >= 400)
        throw new Error(`${action.name} detail returned HTTP ${response.status}`);
      return {
        ...action,
        name: response.body.name ?? action.name,
        label: response.body.label ?? action.label,
        type: response.body.type ?? action.type,
        description: response.body.description,
        inputs: (response.body.inputs ?? [])
          .filter(
            (input): input is typeof input & { name: string } => typeof input.name === "string",
          )
          .map((input) => ({ name: input.name, type: input.type, required: input.required })),
        outputs: (response.body.outputs ?? [])
          .filter(
            (output): output is typeof output & { name: string } => typeof output.name === "string",
          )
          .map((output) => ({ name: output.name, type: output.type })),
      };
    },
    async listSubflows() {
      const query = await session.query<{
        ApiName?: string;
        Label?: string;
        ActiveVersionId?: string;
        LatestVersionId?: string;
      }>({
        soql: "SELECT ApiName, Label, ActiveVersionId, LatestVersionId FROM FlowDefinitionView WHERE ProcessType = 'AutoLaunchedFlow' LIMIT 100",
        api: "rest",
        maxRows: 100,
      });
      return query.records
        .filter(
          (record): record is typeof record & { ApiName: string } =>
            typeof record.ApiName === "string",
        )
        .map((record) => ({
          api_name: record.ApiName,
          label: record.Label,
          active_version_id: record.ActiveVersionId,
          latest_version_id: record.LatestVersionId,
        }));
    },
    async describeSubflow(flow) {
      const versionId = flow.active_version_id ?? flow.latest_version_id;
      if (!versionId) return { ...flow, inputs: [], outputs: [] };
      const response = await session.request<{
        Metadata?: {
          variables?: Array<{
            name?: string;
            dataType?: string;
            objectType?: string;
            isCollection?: boolean;
            isInput?: boolean;
            isOutput?: boolean;
          }>;
        };
      }>({ method: "GET", path: `/tooling/sobjects/Flow/${versionId}` });
      if (response.status >= 400)
        throw new Error(`${flow.api_name} metadata returned HTTP ${response.status}`);
      const variables = response.body.Metadata?.variables ?? [];
      const project = (variable: (typeof variables)[number]) => ({
        name: variable.name ?? "variable",
        data_type: variable.dataType,
        object_type: variable.objectType,
        is_collection: variable.isCollection === true,
      });
      return {
        ...flow,
        inputs: variables.filter((variable) => variable.name && variable.isInput).map(project),
        outputs: variables.filter((variable) => variable.name && variable.isOutput).map(project),
      };
    },
  };
}

export async function collectCustomActionSummaries(
  url: string,
  fetchIndex: (url: string) => Promise<unknown>,
  depth = 0,
): Promise<GroundedActionSummary[]> {
  const body = await fetchIndex(url);
  if (!body || typeof body !== "object") return [];
  const actions = (body as { actions?: unknown }).actions;
  if (Array.isArray(actions)) {
    return actions.filter((action): action is GroundedActionSummary =>
      Boolean(
        action &&
        typeof action === "object" &&
        typeof (action as GroundedActionSummary).name === "string" &&
        typeof (action as GroundedActionSummary).url === "string",
      ),
    );
  }
  if (depth >= 2) return [];
  const childUrls = Object.values(body)
    .filter((value): value is string => typeof value === "string" && value.startsWith("/"))
    .slice(0, 25);
  const nested = await Promise.all(
    childUrls.map((childUrl) => collectCustomActionSummaries(childUrl, fetchIndex, depth + 1)),
  );
  return nested.flat();
}

function selectObjectFields(
  object: GroundedObject,
  terms: string[],
  limit: number,
): GroundedObject {
  const ranked = object.fields
    .map((field) => ({
      field,
      score: matchScore(field, terms) + (["Id", "Name"].includes(field.name) ? 100 : 0),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.field.name.localeCompare(right.field.name),
    );
  const selected = [...new Map(ranked.map(({ field }) => [field.name, field])).values()].slice(
    0,
    limit,
  );
  return {
    ...object,
    fields: selected,
    total_fields: object.fields.length,
    truncated: selected.length < object.fields.length,
  };
}

function intentTerms(intent?: string, objectName?: string, eventName?: string): string[] {
  const stop = new Set([
    "when",
    "then",
    "with",
    "from",
    "into",
    "after",
    "before",
    "record",
    "flow",
  ]);
  return [
    ...new Set(
      `${intent ?? ""} ${objectName ?? ""} ${eventName ?? ""}`
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((term) => term.length >= 3 && !stop.has(term)),
    ),
  ];
}

function matchScore(value: object, terms: string[]): number {
  if (!terms.length) return 0;
  const text = Object.values(value)
    .filter((item) => typeof item === "string")
    .join(" ")
    .toLowerCase();
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
