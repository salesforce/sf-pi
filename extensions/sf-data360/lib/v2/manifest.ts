/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import { inferCsvSchema, type CsvSchemaInference } from "./csv-schema.ts";
import type { Data360V2Step } from "./action-types.ts";

export interface IngestDataset {
  csvPath: string;
  schemaName: string;
  streamName: string;
  primaryKey: string;
  recordModifiedField: string;
}

export interface IngestManifest {
  source: { name: string; connectionId: string };
  datasets: IngestDataset[];
}

export interface PlannedDataset extends IngestDataset {
  inferred: CsvSchemaInference;
  dloName: string;
}

export interface IngestPlan {
  manifest: IngestManifest;
  datasets: PlannedDataset[];
  steps: Data360V2Step[];
}

export async function loadManifest(params: Record<string, unknown>): Promise<IngestManifest> {
  if (typeof params.manifestPath === "string" && params.manifestPath.trim()) {
    const parsed = JSON.parse(await readFile(params.manifestPath.trim(), "utf8")) as unknown;
    return normalizeManifest(parsed);
  }
  return manifestFromSingleCsv(params);
}

export async function planManifest(params: Record<string, unknown>): Promise<IngestPlan> {
  const manifest = await loadManifest(params);
  const datasets: PlannedDataset[] = [];
  for (const dataset of manifest.datasets) {
    const inferred = await inferCsvSchema({
      csvPath: dataset.csvPath,
      schemaName: dataset.schemaName,
      primaryKey: dataset.primaryKey,
      recordModifiedField: dataset.recordModifiedField,
    });
    datasets.push({ ...dataset, inferred, dloName: `${dataset.streamName}__dll` });
  }
  return { manifest, datasets, steps: buildSteps(manifest, datasets) };
}

export function validateManifest(manifest: IngestManifest): string[] {
  const errors: string[] = [];
  if (!manifest.source.name) errors.push("source.name is required");
  if (!manifest.source.connectionId) errors.push("source.connectionId is required");
  const schemaNames = new Set<string>();
  const streamNames = new Set<string>();
  for (const [index, dataset] of manifest.datasets.entries()) {
    const prefix = `datasets[${index}]`;
    if (!dataset.csvPath) errors.push(`${prefix}.csvPath is required`);
    if (!dataset.schemaName) errors.push(`${prefix}.schemaName is required`);
    if (!dataset.streamName) errors.push(`${prefix}.streamName is required`);
    if (!dataset.primaryKey) errors.push(`${prefix}.primaryKey is required`);
    if (schemaNames.has(dataset.schemaName))
      errors.push(`${prefix}.schemaName duplicates ${dataset.schemaName}`);
    if (streamNames.has(dataset.streamName))
      errors.push(`${prefix}.streamName duplicates ${dataset.streamName}`);
    schemaNames.add(dataset.schemaName);
    streamNames.add(dataset.streamName);
  }
  return errors;
}

function normalizeManifest(value: unknown): IngestManifest {
  const record = asRecord(value);
  if (!record) throw new Error("Manifest must be a JSON object.");
  const source = asRecord(record.source);
  const datasets = Array.isArray(record.datasets) ? record.datasets.map(normalizeDataset) : [];
  const manifest = {
    source: {
      name: requiredString(source, "source.name", "name"),
      connectionId: requiredString(source, "source.connectionId", "connectionId"),
    },
    datasets,
  };
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Invalid Data 360 ingest manifest: ${errors.join("; ")}`);
  return manifest;
}

function manifestFromSingleCsv(params: Record<string, unknown>): IngestManifest {
  const manifest = {
    source: {
      name: requiredString(params, "sourceName"),
      connectionId: requiredString(params, "connectionId"),
    },
    datasets: [normalizeDataset(params)],
  };
  const errors = validateManifest(manifest);
  if (errors.length) throw new Error(`Invalid Data 360 ingest parameters: ${errors.join("; ")}`);
  return manifest;
}

function normalizeDataset(value: unknown): IngestDataset {
  const record = asRecord(value) ?? {};
  return {
    csvPath: requiredString(record, "csvPath"),
    schemaName: requiredString(record, "schemaName"),
    streamName: requiredString(record, "streamName"),
    primaryKey: requiredString(record, "primaryKey"),
    recordModifiedField: stringParam(record, "recordModifiedField", "CreatedDate"),
  };
}

function buildSteps(manifest: IngestManifest, datasets: PlannedDataset[]): Data360V2Step[] {
  const steps: Data360V2Step[] = [];
  for (const dataset of datasets) {
    steps.push(
      {
        label: `Infer schema for ${dataset.csvPath}`,
        tool: "data360_prepare",
        action: "csv_schema.infer",
        params: { csvPath: dataset.csvPath },
      },
      {
        label: `Validate source schema ${dataset.schemaName}`,
        tool: "data360_connect",
        action: "source_schema.test",
        params: { connectionId: manifest.source.connectionId },
      },
      {
        label: `Upload source schema ${dataset.schemaName}`,
        tool: "data360_connect",
        action: "source_schema.put",
        params: { connectionId: manifest.source.connectionId },
        safety: "confirmed",
      },
      {
        label: `Create stream ${dataset.streamName}`,
        tool: "data360_prepare",
        action: "stream.create_ingest_api",
        params: { sourceName: manifest.source.name, schemaName: dataset.schemaName },
        safety: "confirmed",
      },
      {
        label: `Create ingest job ${dataset.schemaName}`,
        tool: "data360_prepare",
        action: "ingest_job.create",
        safety: "confirmed",
      },
      {
        label: `Upload CSV ${dataset.csvPath}`,
        tool: "data360_prepare",
        action: "ingest_job.upload_csv",
        safety: "confirmed",
      },
      {
        label: `Close ingest job ${dataset.schemaName}`,
        tool: "data360_prepare",
        action: "ingest_job.close",
        safety: "confirmed",
      },
      {
        label: `Poll ingest job ${dataset.schemaName}`,
        tool: "data360_prepare",
        action: "ingest_job.poll",
      },
      {
        label: `Verify rows for ${dataset.dloName}`,
        tool: "data360_query",
        action: "sql.verify_rows",
        params: { dloName: dataset.dloName },
      },
    );
  }
  return steps;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(
  params: Record<string, unknown> | undefined,
  key: string,
  actualKey = key,
): string {
  const value = params?.[actualKey];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing required parameter '${key}'.`);
  return value.trim();
}

function stringParam(params: Record<string, unknown>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
