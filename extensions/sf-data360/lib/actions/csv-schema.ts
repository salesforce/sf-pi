/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";

export interface CsvSchemaInference {
  csvPath: string;
  schema: {
    name: string;
    label: string;
    schemaType: "IngestApi";
    fields: Array<{ name: string; label: string; dataType: string }>;
  };
  primaryKey: string;
  recordModifiedField: string;
}

export async function inferCsvSchema(params: Record<string, unknown>): Promise<CsvSchemaInference> {
  const csvPath = requiredString(params, "csvPath");
  const schemaName = apiSafeName(requiredString(params, "schemaName"), "schemaName");
  const primaryKey = requiredString(params, "primaryKey");
  const recordModifiedField = stringParam(params, "recordModifiedField", "CreatedDate");
  const text = await readFile(csvPath, "utf8");
  const [headerLine, ...sampleLines] = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (!headerLine) throw new Error("CSV file is empty.");
  const headers = splitCsvLine(headerLine).map((header) => header.trim());
  if (!headers.includes(primaryKey)) throw new Error(`CSV missing primary key '${primaryKey}'.`);
  const rows = sampleLines.slice(0, 25).map(splitCsvLine);
  const fields = headers.map((header, index) => ({
    name: apiSafeName(header, "CSV header"),
    label: header,
    dataType: inferType(header, rows.map((row) => row[index]).filter(Boolean)),
  }));
  if (!fields.some((field) => field.name === recordModifiedField)) {
    fields.push({ name: recordModifiedField, label: recordModifiedField, dataType: "DateTime" });
  }
  return {
    csvPath,
    schema: { name: schemaName, label: schemaName, schemaType: "IngestApi", fields },
    primaryKey,
    recordModifiedField,
  };
}

export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function inferType(header: string, values: string[]): string {
  if (header === "CreatedDate" || values.some((value) => /T\d{2}:\d{2}:\d{2}/.test(value))) {
    return "DateTime";
  }
  if (values.length && values.every((value) => /^(true|false)$/i.test(value))) return "Boolean";
  if (
    values.length &&
    values.every((value) => value.trim() !== "" && !Number.isNaN(Number(value)))
  ) {
    return "Number";
  }
  if (values.length && values.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) return "Date";
  return "Text";
}

function apiSafeName(value: string, label: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be API-safe: ${value}`);
  }
  return value;
}

function requiredString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing required parameter '${key}'.`);
  return value.trim();
}

function stringParam(params: Record<string, unknown>, key: string, fallback: string): string {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
