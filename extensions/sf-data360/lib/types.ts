/* SPDX-License-Identifier: Apache-2.0 */
/** Stable result and presentation contracts for the sf_data360 SDK tool. */
import type { JsonObject, JsonValue } from "@earendil-works/pi-ai";
import type { Data360Namespace, SfData360Input } from "./actions/action-types.ts";

export type Data360RunStatus = "pass" | "warning" | "fail" | "planned" | "info";
export type Data360Transport = "connect" | "query-v3" | "ingestion" | "local";

export interface Data360DigestRow {
  icon: string;
  label: string;
  value: string;
}

export interface Data360DigestTable {
  columns: string[];
  rows: string[][];
  omittedRows?: number;
}

export interface Data360RunSection {
  icon: string;
  title: string;
  rows?: Data360DigestRow[];
  code?: { language: "sql" | "json" | "text"; lines: string[]; omittedLines?: number };
  table?: Data360DigestTable;
  expandedOnly?: boolean;
}

export interface Data360ApiCallRailItem {
  transport: "CONNECT" | "QUERY V3" | "INGEST" | "LOCAL";
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  outcome?: "success" | "warning" | "failed" | "planned";
  detail?: string;
}

export interface Data360RunDigest {
  action: string;
  namespace: Data360Namespace;
  status: Data360RunStatus;
  icon: string;
  title: string;
  summary: string;
  target?: {
    alias?: string;
    apiVersion?: string;
    dataspace?: string;
  };
  transport?: {
    preferred?: Data360Transport;
    used: Data360Transport;
    fallback?: { from: Data360Transport; reason: string };
  };
  api_calls?: Data360ApiCallRailItem[];
  sections: Data360RunSection[];
  artifacts?: Array<{ path: string; kind: string; label?: string }>;
  next_step?: string;
}

export type Data360StructuredResult = JsonObject & {
  outcome: JsonObject & {
    action: string;
    namespace: Data360Namespace;
    status: Data360RunStatus;
    summary: string;
  };
  data?: JsonValue;
  transport?: JsonValue;
  artifacts?: JsonValue;
};

export interface SfData360ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown> & { digest: Data360RunDigest };
  structuredContent: Data360StructuredResult;
}

export interface BuildData360DigestInput {
  input: SfData360Input;
  result: Record<string, unknown>;
  artifactPath?: string;
  outputMode: "summary" | "inline" | "file_only";
}
