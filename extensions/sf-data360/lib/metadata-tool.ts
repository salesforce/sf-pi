/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Compact Data 360 metadata helper.
 *
 * This tool exists to keep common discovery tasks out of broad, nested catalog
 * endpoints. It deliberately returns compact lists/descriptions and leaves raw
 * endpoint access to d360_api for advanced workflows.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai/base";
import { Type } from "typebox";

import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import { connRequest } from "../../../lib/common/sf-conn/request.ts";
import { buildApiPath } from "./path.ts";
import { responseLooksLikeError } from "./api-tool.ts";
import { renderCardForLlm } from "./display/card.ts";
import { metadataResultToCard } from "./display/metadata-card.ts";
import { renderD360MetadataCall, renderD360MetadataResult } from "./display/render.ts";
import { resolveTargetOrgContext } from "./target-org.ts";
import { buildD360Envelope, truncateD360Output, writeFullD360Output } from "./truncation.ts";

export const D360_METADATA_TOOL_NAME = "d360_metadata";

const MetadataAction = StringEnum(
  ["list_dmos", "describe_dmo", "list_dlos", "describe_dlo"] as const,
  { description: "Compact Data 360 metadata action to run." },
);

type MetadataActionValue = "list_dmos" | "describe_dmo" | "list_dlos" | "describe_dlo";

export const D360MetadataParams = Type.Object({
  action: MetadataAction,
  api_name: Type.Optional(
    Type.String({ description: "DMO or DLO API name for describe actions." }),
  ),
  category: Type.Optional(
    Type.String({ description: "Optional category filter for list actions, case-insensitive." }),
  ),
  max_fields: Type.Optional(
    Type.Number({ description: "Maximum fields to include for describe actions. Defaults to 50." }),
  ),
  max_results: Type.Optional(
    Type.Number({ description: "Maximum rows to show for list actions. Defaults to 25." }),
  ),
  target_org: Type.Optional(
    Type.String({
      description:
        "Salesforce org alias or username. Defaults to the active sf-pi target org when available.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Optional command timeout in milliseconds. Defaults to 120000." }),
  ),
});

export interface D360MetadataInput {
  action: MetadataActionValue;
  api_name?: string;
  category?: string;
  max_fields?: number;
  max_results?: number;
  target_org?: string;
  timeout_ms?: number;
}

interface MetadataExecutionPlan {
  path: string;
  kind: "list" | "describe";
  entityType: "DataModelObject" | "DataLakeObject";
}

interface MetadataEntity {
  category?: string;
  displayName?: string;
  label?: string;
  name?: string;
  type?: string;
}

interface DataField {
  name?: string;
  label?: string;
  type?: string;
  dataType?: string;
  isPrimaryKey?: boolean;
  isMapped?: boolean;
  usageTag?: string;
  creationType?: string;
}

export function registerD360MetadataTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: D360_METADATA_TOOL_NAME,
    label: "Data 360 Metadata",
    description:
      "Compact helpers for common Data 360 metadata discovery: list/describe DMOs and DLOs without returning broad nested catalog payloads.",
    promptSnippet: "List or describe Data 360 DMOs/DLOs with compact, context-safe output",
    promptGuidelines: [
      "Use d360_metadata list_dmos for simple DMO lists instead of broad /ssot/data-model-objects catalog calls.",
      "List actions cap inline rows by default; use category, max_results, or the saved raw JSON for wider inventory.",
      "Use d360_metadata describe_dmo before querying DMO records to verify fields and query shape.",
      "Use d360_metadata list_dlos or describe_dlo for compact Data Lake Object discovery before mapping or stream work.",
    ],
    parameters: D360MetadataParams,
    renderCall: renderD360MetadataCall,
    renderResult: renderD360MetadataResult,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as D360MetadataInput;
      const env = await resolveEnvironment(exec, ctx);
      // Resolve apiVersion against the *target* org, not the active sf-pi org.
      // Otherwise a target_org on a different release than the default produces
      // /services/data/v<wrong>/... URLs that 404 silently.
      const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
      if (!targetOrg)
        throw new Error(
          "No Salesforce target org is configured. Pass target_org or set sf config target-org.",
        );

      const plan = buildMetadataExecutionPlan(input);
      const apiPath = buildApiPath(plan.path, apiVersion);
      if (signal?.aborted) throw new Error("d360_metadata call cancelled before request.");
      const conn = await connFromAlias(targetOrg);
      const resp = await connRequest<unknown>(conn, {
        method: "GET",
        url: apiPath,
        timeoutMs: typeof input.timeout_ms === "number" ? input.timeout_ms : 120_000,
      });
      const output = stringifyMetadataBody(resp.body);
      const ok = resp.status >= 200 && resp.status < 300 && !responseLooksLikeError(output);
      if (!ok) {
        const formatted = await truncateD360Output(output);
        const errorDetails: Record<string, unknown> = {
          ok,
          action: input.action,
          path: apiPath,
          targetOrg,
          status: resp.status,
          ...(formatted.truncation ? { truncation: formatted.truncation } : {}),
          ...(formatted.fullOutputPath ? { fullOutputPath: formatted.fullOutputPath } : {}),
        };
        return {
          content: [{ type: "text" as const, text: formatted.text }],
          details: {
            ...errorDetails,
            sfPi: buildD360Envelope(
              D360_METADATA_TOOL_NAME,
              false,
              output,
              errorDetails,
              formatted,
            ),
          },
          isError: true,
        };
      }

      const rawOutputPath = await writeFullD360Output(output);
      const summary = summarizeMetadataOutput(input, output, rawOutputPath);
      const card = metadataResultToCard(input, summary.text, summary.details, {
        targetOrg,
        apiVersion,
        requestPath: apiPath,
        rawOutputPath,
      });
      const compactText = renderCardForLlm(card);
      const successDetails: Record<string, unknown> = {
        ok: true,
        action: input.action,
        path: apiPath,
        targetOrg,
        rawOutputPath,
        card,
        ...summary.details,
      };
      const sfPi = buildD360Envelope(D360_METADATA_TOOL_NAME, true, compactText, successDetails, {
        text: compactText,
        fullOutputPath: rawOutputPath,
      });
      sfPi.data = { card };
      sfPi.renderHints = { profile: "balanced", collapsedLines: 48, expandedMaxLines: 120 };
      return {
        content: [{ type: "text" as const, text: compactText }],
        details: {
          ...successDetails,
          sfPi,
        },
      };
    },
  });
}

async function resolveEnvironment(
  exec: ReturnType<typeof buildExecFn>,
  ctx: ExtensionContext,
): Promise<SfEnvironment> {
  return getCachedSfEnvironment(ctx.cwd) ?? (await getSharedSfEnvironment(exec, ctx.cwd));
}

function stringifyMetadataBody(body: unknown): string {
  if (typeof body === "string") return body;
  if (body === undefined || body === null) return "";
  try {
    return JSON.stringify(body, null, 2);
  } catch {
    return String(body);
  }
}

export function buildMetadataExecutionPlan(input: D360MetadataInput): MetadataExecutionPlan {
  switch (input.action) {
    case "list_dmos":
      return {
        path: "/ssot/metadata-entities?entityType=DataModelObject",
        kind: "list",
        entityType: "DataModelObject",
      };
    case "list_dlos":
      return {
        path: "/ssot/metadata-entities?entityType=DataLakeObject",
        kind: "list",
        entityType: "DataLakeObject",
      };
    case "describe_dmo":
      return {
        path: `/ssot/data-model-objects/${requiredApiName(input)}`,
        kind: "describe",
        entityType: "DataModelObject",
      };
    case "describe_dlo":
      return {
        path: `/ssot/data-lake-objects/${requiredApiName(input)}`,
        kind: "describe",
        entityType: "DataLakeObject",
      };
    default:
      return assertNever(input.action);
  }
}

export function summarizeMetadataOutput(
  input: D360MetadataInput,
  rawJson: string,
  rawOutputPath: string,
): { text: string; details: Record<string, unknown> } {
  const parsed = parseJson(rawJson);
  if (!parsed || typeof parsed !== "object") {
    return {
      text: `Data 360 metadata response was not JSON. Raw output: ${rawOutputPath}`,
      details: { rawOutputPath },
    };
  }

  if (input.action === "list_dmos" || input.action === "list_dlos") {
    return summarizeMetadataList(input, parsed as Record<string, unknown>, rawOutputPath);
  }
  return summarizeMetadataDescription(
    input,
    unwrapDescription(parsed as Record<string, unknown>),
    rawOutputPath,
  );
}

function unwrapDescription(parsed: Record<string, unknown>): Record<string, unknown> {
  if (Array.isArray(parsed.dataModelObject) && parsed.dataModelObject.length === 1) {
    return parsed.dataModelObject[0] as Record<string, unknown>;
  }
  if (Array.isArray(parsed.dataLakeObjects) && parsed.dataLakeObjects.length === 1) {
    return parsed.dataLakeObjects[0] as Record<string, unknown>;
  }
  if (Array.isArray(parsed.items) && parsed.items.length === 1) {
    return parsed.items[0] as Record<string, unknown>;
  }
  return parsed;
}

function summarizeMetadataList(
  input: D360MetadataInput,
  parsed: Record<string, unknown>,
  rawOutputPath: string,
): { text: string; details: Record<string, unknown> } {
  const allEntities = extractMetadataEntities(parsed);
  const category = input.category?.trim().toLowerCase();
  const entities = category
    ? allEntities.filter((entity) => entity.category?.toLowerCase() === category)
    : allEntities;
  entities.sort((a, b) =>
    `${a.category ?? ""}\u0000${a.displayName ?? a.label ?? ""}\u0000${a.name ?? ""}`.localeCompare(
      `${b.category ?? ""}\u0000${b.displayName ?? b.label ?? ""}\u0000${b.name ?? ""}`,
    ),
  );

  const label = input.action === "list_dmos" ? "DMOs" : "DLOs";
  const availableCategories = uniqueSorted(
    allEntities.map((entity) => entity.category).filter((value): value is string => Boolean(value)),
  );
  const categoryCounts = countByCategory(allEntities);
  const maxResults = normalizeMaxResults(input.max_results);
  const shownEntities = entities.slice(0, maxResults);
  const lines = [
    `Found ${entities.length} ${label}${category ? ` in category ${input.category}` : ""}.`,
    `Showing ${shownEntities.length} of ${entities.length}. Raw output: ${rawOutputPath}`,
  ];
  if (categoryCounts.length > 0) {
    lines.push(
      `Category counts: ${categoryCounts.map(([name, count]) => `${name}=${count}`).join(", ")}.`,
    );
  }
  if (category && entities.length === 0 && availableCategories.length > 0) {
    lines.push(
      `No compact metadata category matched. Available categories: ${availableCategories.join(", ")}.`,
      "Note: compact metadata categories can differ from detailed DLO/DMO schema categories.",
    );
  }
  if (entities.length > shownEntities.length) {
    lines.push(
      `Use category or max_results to narrow the inline table; the full response is saved above.`,
    );
  }
  if (shownEntities.length > 0) {
    lines.push("", "| Category | Display Name | API Name |", "|---|---|---|");
    for (const entity of shownEntities) {
      lines.push(
        `| ${escapeTable(entity.category ?? "")} | ${escapeTable(
          entity.displayName ?? entity.label ?? "",
        )} | \`${escapeTable(entity.name ?? "")}\` |`,
      );
    }
  }

  return {
    text: lines.join("\n"),
    details: {
      count: entities.length,
      shownCount: shownEntities.length,
      unfilteredCount: allEntities.length,
      category: input.category,
      availableCategories,
      categoryCounts: Object.fromEntries(categoryCounts),
      rawOutputPath,
    },
  };
}

function summarizeMetadataDescription(
  input: D360MetadataInput,
  parsed: Record<string, unknown>,
  rawOutputPath: string,
): { text: string; details: Record<string, unknown> } {
  const fields = extractFields(parsed);
  const maxFields = normalizeMaxFields(input.max_fields);
  const shownFields = fields.slice(0, maxFields);
  const lines = [
    `${parsed.label ?? parsed.displayName ?? parsed.name ?? input.api_name}`,
    `API name: \`${parsed.name ?? input.api_name ?? ""}\``,
    `Category: ${parsed.category ?? "(unknown)"}`,
    `Data space: ${parsed.dataSpaceName ?? "(unknown)"}`,
    `Enabled: ${formatUnknownBoolean(parsed.isEnabled)}`,
    `Segmentable: ${formatUnknownBoolean(parsed.isSegmentable)}`,
    `Editable: ${formatUnknownBoolean(parsed.isEditable)}`,
    `Fields: ${fields.length}${fields.length > shownFields.length ? ` (showing ${shownFields.length})` : ""}`,
    `Raw output: ${rawOutputPath}`,
  ];

  if (shownFields.length > 0) {
    lines.push(
      "",
      "| Field | Label | Type | Primary Key | Mapped | Usage |",
      "|---|---|---|---:|---:|---|",
    );
    for (const field of shownFields) {
      lines.push(
        `| \`${escapeTable(field.name ?? "")}\` | ${escapeTable(field.label ?? "")} | ${escapeTable(
          field.type ?? field.dataType ?? "",
        )} | ${field.isPrimaryKey ? "yes" : ""} | ${field.isMapped ? "yes" : ""} | ${escapeTable(
          field.usageTag ?? "",
        )} |`,
      );
    }
  }

  return {
    text: lines.join("\n"),
    details: {
      apiName: parsed.name ?? input.api_name,
      fieldCount: fields.length,
      shownFieldCount: shownFields.length,
      rawOutputPath,
    },
  };
}

function extractMetadataEntities(parsed: Record<string, unknown>): MetadataEntity[] {
  if (Array.isArray(parsed.metadata)) return parsed.metadata as MetadataEntity[];
  if (Array.isArray(parsed.dataModelObject)) return parsed.dataModelObject as MetadataEntity[];
  if (Array.isArray(parsed.dataLakeObjects)) return parsed.dataLakeObjects as MetadataEntity[];
  if (Array.isArray(parsed.items)) return parsed.items as MetadataEntity[];
  return [];
}

function extractFields(parsed: Record<string, unknown>): DataField[] {
  if (Array.isArray(parsed.fields)) return parsed.fields as DataField[];
  if (Array.isArray(parsed.dataFields)) return parsed.dataFields as DataField[];
  return [];
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function countByCategory(entities: MetadataEntity[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    const category = entity.category || "(none)";
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return Array.from(counts).sort(([a], [b]) => a.localeCompare(b));
}

function requiredApiName(input: D360MetadataInput): string {
  const apiName = input.api_name?.trim();
  if (!apiName) throw new Error(`${input.action} requires api_name.`);
  return encodeURIComponent(apiName);
}

function normalizeMaxFields(maxFields: number | undefined): number {
  if (typeof maxFields !== "number" || !Number.isFinite(maxFields)) return 50;
  return Math.max(0, Math.floor(maxFields));
}

function normalizeMaxResults(maxResults: number | undefined): number {
  if (typeof maxResults !== "number" || !Number.isFinite(maxResults)) return 25;
  return Math.max(0, Math.floor(maxResults));
}

function formatUnknownBoolean(value: unknown): string {
  return typeof value === "boolean" ? String(value) : "(unknown)";
}

function parseJson(text: string): unknown {
  try {
    return text.trim() ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function escapeTable(value: string): string {
  // Escape `\` first, then `|`, so a literal backslash in the cell value
  // can't pair with the inserted `\` from the pipe-escape pass and break
  // the markdown table column separator.
  return value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function assertNever(value: never): never {
  throw new Error(`Unsupported metadata action: ${String(value)}`);
}
