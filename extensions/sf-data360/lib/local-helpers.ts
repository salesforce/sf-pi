/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic local actions exposed through the sf_data360 action catalog. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STANDARD_MAPPINGS_PATH = path.resolve(
  __dirname,
  "..",
  "registry",
  "generated",
  "standard-mappings.json",
);

const LOCAL_HELPERS = new Set([
  "d360_standard_mapping_preview",
  "d360_smart_mapping_suggest",
  "d360_preview_field_matches",
  "d360_smart_datastream_create",
  "d360_event_date_recommend",
]);

interface FieldLike {
  name?: string;
  label?: string;
  dataType?: string;
  type?: string;
}

interface FieldMatch {
  sourceField: string;
  targetField: string;
  confidence: number;
  reason: string;
}

interface StandardFieldMapping {
  sourceField: string;
  targetField: string;
  isFilterApplied?: boolean;
  filterOperationType?: string;
}

interface StandardDmoMapping {
  dmoName: string;
  fieldMappings: StandardFieldMapping[];
}

interface StandardMappingDefinition {
  sourceObjectName: string;
  dmoMappings: StandardDmoMapping[];
}

interface EventDateCandidate {
  fieldName: string;
  label?: string;
  dataType?: string;
  score: number;
  reasons: string[];
}

type StandardMappingIndex = Record<string, StandardMappingDefinition>;

let standardMappingsCache: StandardMappingIndex | undefined;

export function isLocalD360Helper(operationName: string): boolean {
  return LOCAL_HELPERS.has(operationName);
}

export function runLocalD360Helper(
  operationName: string,
  params: Record<string, unknown>,
): Record<string, unknown> {
  switch (operationName) {
    case "d360_standard_mapping_preview":
      return standardMappingPreview(params);
    case "d360_preview_field_matches":
      return previewFieldMatches(params);
    case "d360_smart_mapping_suggest":
      return smartMappingSuggest(params);
    case "d360_event_date_recommend":
      return eventDateRecommend(params);
    case "d360_smart_datastream_create":
      return smartDatastreamCreate(params);
    default:
      throw new Error(`Unknown local Data 360 action: ${operationName}`);
  }
}

function standardMappingPreview(params: Record<string, unknown>): Record<string, unknown> {
  const sourceObjectName = requiredString(params.sourceObjectName, "sourceObjectName");
  const targetDmoName = optionalString(params.targetDmoName);
  const mappings = loadStandardMappings();
  const mapping = findStandardMapping(mappings, sourceObjectName);

  if (!mapping) {
    return {
      ok: true,
      action: "execute",
      helper: "d360_standard_mapping_preview",
      found: false,
      sourceObjectName,
      availableStandardMappings: Object.keys(mappings).length,
      summary: `No standard mapping found for ${sourceObjectName}`,
      next: {
        operation: "d360_preview_field_matches",
        hint: "Use smart field-match preview or manual d360_dmo_mapping_create after describing DLO and DMO fields.",
      },
    };
  }

  const dmoMappings = targetDmoName
    ? mapping.dmoMappings.filter(
        (entry) => entry.dmoName.toLowerCase() === targetDmoName.toLowerCase(),
      )
    : mapping.dmoMappings;

  const preview = dmoMappings.map((entry) => ({
    targetDmoName: entry.dmoName,
    fieldMappingCount: entry.fieldMappings.length,
    fieldMappings: entry.fieldMappings,
    createPayload: {
      sourceEntityDeveloperName: sourceObjectName,
      targetEntityDeveloperName: entry.dmoName,
      fieldMapping: entry.fieldMappings.map((field) => ({
        sourceFieldDeveloperName: field.sourceField,
        targetFieldDeveloperName: field.targetField,
      })),
    },
  }));

  return {
    ok: true,
    action: "execute",
    helper: "d360_standard_mapping_preview",
    found: true,
    sourceObjectName: mapping.sourceObjectName,
    targetDmoCount: preview.length,
    dmoMappings: preview,
    summary: `Standard mappings available for ${mapping.sourceObjectName}: ${preview.length} target DMO(s)`,
    next: {
      operation: "d360_standard_mapping_create",
      dry_run: true,
      params: preview.length === 1 ? { body: preview[0]?.createPayload } : undefined,
      hint:
        preview.length === 1
          ? "Review createPayload, then dry-run d360_standard_mapping_create."
          : "Pick one target DMO createPayload, then dry-run d360_standard_mapping_create.",
    },
  };
}

function previewFieldMatches(params: Record<string, unknown>): Record<string, unknown> {
  const sourceFields = getFields(params.sourceFields, "sourceFields");
  const targetFields = getFields(params.targetFields, "targetFields");
  const threshold = optionalNumber(params.threshold) ?? 0.45;
  const matches = matchFields(sourceFields, targetFields, threshold);

  return {
    ok: true,
    action: "execute",
    helper: "d360_preview_field_matches",
    threshold,
    sourceFieldCount: sourceFields.length,
    targetFieldCount: targetFields.length,
    matchCount: matches.length,
    matches,
    unmatchedSourceFields: sourceFields
      .map(fieldName)
      .filter((name) => !matches.some((match) => match.sourceField === name)),
    summary: `Found ${matches.length} field match(es) at threshold ${threshold}`,
    next: {
      operation: "d360_smart_mapping_suggest",
      params,
      hint: "If matches look correct, run smart mapping suggest to produce a d360_dmo_mapping_create payload.",
    },
  };
}

function smartMappingSuggest(params: Record<string, unknown>): Record<string, unknown> {
  const sourceFields = getFields(params.sourceFields, "sourceFields");
  const targetFields = getFields(params.targetFields, "targetFields");
  const sourceDloName = requiredString(params.sourceDloName, "sourceDloName");
  const targetDmoName = requiredString(params.targetDmoName, "targetDmoName");
  const threshold = optionalNumber(params.threshold) ?? 0.45;
  const automaticMatches = matchFields(sourceFields, targetFields, threshold);
  const overrideMatches = getFieldOverrides(params.fieldOverrides);
  const matches = mergeMatches(automaticMatches, overrideMatches);
  const mappingPayload = {
    sourceEntityDeveloperName: sourceDloName,
    targetEntityDeveloperName: targetDmoName,
    fieldMapping: matches.map((match) => ({
      sourceFieldDeveloperName: match.sourceField,
      targetFieldDeveloperName: match.targetField,
    })),
  };

  return {
    ok: true,
    action: "execute",
    helper: "d360_smart_mapping_suggest",
    threshold,
    sourceDloName,
    targetDmoName,
    matchCount: matches.length,
    matches,
    mappingPayload,
    summary: `Suggested ${matches.length} DLO-to-DMO field mapping(s)`,
    next: {
      operation: "d360_dmo_mapping_create",
      dry_run: true,
      params: { body: mappingPayload },
      hint: "Review mappingPayload, then dry-run d360_dmo_mapping_create before confirmed execution.",
    },
  };
}

function eventDateRecommend(params: Record<string, unknown>): Record<string, unknown> {
  const fields = getFields(
    params.fields ?? parseJsonString(params.fieldsJson, "fieldsJson"),
    "fields",
  );
  const category = optionalString(params.category) ?? "Engagement";
  const candidates = fields
    .filter((field) => isDateField(field))
    .map((field) => scoreEventDateField(field, category))
    .sort((a, b) => b.score - a.score || a.fieldName.localeCompare(b.fieldName));

  return {
    ok: true,
    action: "execute",
    helper: "d360_event_date_recommend",
    category,
    recommendation: candidates[0] ?? null,
    candidates,
    summary: candidates[0]
      ? `Recommended event date field: ${candidates[0].fieldName}`
      : "No date/datetime fields found",
  };
}

function smartDatastreamCreate(params: Record<string, unknown>): Record<string, unknown> {
  const body = getBodyObject(params);
  const autoSelect = params.autoSelectEventDate !== false;
  const dataLakeObjectInfo = asRecord(body.dataLakeObjectInfo) ?? {};
  const category = optionalString(dataLakeObjectInfo.category) ?? "Engagement";
  const fields = getFields(
    body.sourceFields ?? dataLakeObjectInfo.dataLakeFieldInputRepresentations ?? [],
    "body.sourceFields",
  );
  const recommendation = autoSelect
    ? eventDateRecommend({ fields, category }).recommendation
    : null;
  const enhancedBody = structuredClonePolyfill(body);

  const enhancedDataLakeObjectInfo = asRecord(enhancedBody.dataLakeObjectInfo);
  if (
    autoSelect &&
    recommendation &&
    category.toLowerCase() === "engagement" &&
    enhancedDataLakeObjectInfo
  ) {
    enhancedDataLakeObjectInfo.eventDateTimeFieldName = asRecord(recommendation)?.fieldName;
  }

  return {
    ok: true,
    action: "execute",
    helper: "d360_smart_datastream_create",
    category,
    recommendation,
    enhancedBody,
    changed: JSON.stringify(enhancedBody) !== JSON.stringify(body),
    summary: recommendation
      ? `Enhanced data stream body with event date recommendation ${asRecord(recommendation)?.fieldName}`
      : "Returned data stream body without event date changes",
    next: {
      operation: "d360_datastream_create",
      dry_run: true,
      params: { body: enhancedBody },
      hint: "Review enhancedBody, then dry-run d360_datastream_create before confirmed execution.",
    },
  };
}

function loadStandardMappings(): StandardMappingIndex {
  standardMappingsCache ??= JSON.parse(readFileSync(STANDARD_MAPPINGS_PATH, "utf8"));
  return standardMappingsCache;
}

function findStandardMapping(
  mappings: StandardMappingIndex,
  sourceObjectName: string,
): StandardMappingDefinition | undefined {
  if (mappings[sourceObjectName]) return mappings[sourceObjectName];
  const normalized = normalizeSourceObjectName(sourceObjectName);
  return mappings[normalized];
}

function normalizeSourceObjectName(value: string): string {
  return value
    .replace(/__dll$/i, "")
    .replace(/_00[a-zA-Z0-9]+$/, "")
    .replace(/_Home$/i, "");
}

function matchFields(
  sourceFields: FieldLike[],
  targetFields: FieldLike[],
  threshold: number,
): FieldMatch[] {
  const usedTargets = new Set<string>();
  const matches: FieldMatch[] = [];
  for (const source of sourceFields) {
    const candidates = targetFields
      .map((target) => ({ source, target, confidence: similarity(source, target) }))
      .filter((candidate) => candidate.confidence >= threshold)
      .sort(
        (a, b) =>
          b.confidence - a.confidence || fieldName(a.target).localeCompare(fieldName(b.target)),
      );
    const best = candidates.find((candidate) => !usedTargets.has(fieldName(candidate.target)));
    if (best) {
      usedTargets.add(fieldName(best.target));
      matches.push({
        sourceField: fieldName(best.source),
        targetField: fieldName(best.target),
        confidence: round(best.confidence),
        reason: best.confidence === 1 ? "exact normalized match" : "name/label similarity",
      });
    }
  }
  return matches;
}

function similarity(source: FieldLike, target: FieldLike): number {
  const sourceTokens = tokenizeField(source);
  const targetTokens = tokenizeField(target);
  if (sourceTokens.join(" ") === targetTokens.join(" ")) return 1;
  const sourceSet = new Set(sourceTokens);
  const targetSet = new Set(targetTokens);
  const intersection = [...sourceSet].filter((token) => targetSet.has(token)).length;
  const union = new Set([...sourceSet, ...targetSet]).size || 1;
  return intersection / union;
}

function tokenizeField(field: FieldLike): string[] {
  return [field.name, field.label]
    .filter((part): part is string => typeof part === "string")
    .flatMap((part) =>
      part
        .replace(/(__c|__dlm|__dll)$/i, "")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean),
    );
}

function scoreEventDateField(field: FieldLike, category: string): EventDateCandidate {
  const name = fieldName(field);
  const normalized = name.toLowerCase();
  let score = 50;
  const reasons: string[] = [];
  if (normalized.includes("event") || normalized.includes("activity")) {
    score += 30;
    reasons.push("event/activity-related name");
  }
  if (normalized.includes("created")) {
    score += 20;
    reasons.push("created timestamp is immutable");
  }
  if (normalized.includes("modified") || normalized.includes("updated")) {
    score -= 25;
    reasons.push("modified/updated timestamps are mutable");
  }
  if (category.toLowerCase() === "engagement") {
    score += 10;
    reasons.push("engagement stream needs event date");
  }
  return {
    fieldName: name,
    label: field.label,
    dataType: field.dataType ?? field.type,
    score,
    reasons,
  };
}

function isDateField(field: FieldLike): boolean {
  const dataType = String(field.dataType ?? field.type ?? "").toLowerCase();
  return dataType === "date" || dataType === "datetime" || dataType === "dateonly";
}

function mergeMatches(automaticMatches: FieldMatch[], overrideMatches: FieldMatch[]): FieldMatch[] {
  const bySource = new Map(automaticMatches.map((match) => [match.sourceField, match]));
  for (const override of overrideMatches) bySource.set(override.sourceField, override);
  return [...bySource.values()];
}

function getFieldOverrides(value: unknown): FieldMatch[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const item = asRecord(entry) ?? {};
    return {
      sourceField: requiredString(
        item.sourceField ?? item.sourceFieldDeveloperName,
        "fieldOverrides.sourceField",
      ),
      targetField: requiredString(
        item.targetField ?? item.targetFieldDeveloperName,
        "fieldOverrides.targetField",
      ),
      confidence: 1,
      reason: "explicit override",
    };
  });
}

function getFields(value: unknown, label: string): FieldLike[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry, index) => {
    const record = asRecord(entry);
    if (!record) throw new Error(`${label}[${index}] must be an object.`);
    return {
      name:
        optionalString(record.name) ?? requiredString(record.fieldName, `${label}[${index}].name`),
      label: optionalString(record.label),
      dataType: optionalString(record.dataType),
      type: optionalString(record.type),
    };
  });
}

function getBodyObject(params: Record<string, unknown>): Record<string, unknown> {
  const body = params.body ?? parseJsonString(params.bodyJson, "bodyJson");
  const record = asRecord(body);
  if (!record) throw new Error("body or bodyJson must be an object.");
  return record;
}

function parseJsonString(value: unknown, label: string): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(
      `${label} must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
      },
    );
  }
}

function fieldName(field: FieldLike): string {
  return requiredString(field.name, "field.name");
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function structuredClonePolyfill<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
