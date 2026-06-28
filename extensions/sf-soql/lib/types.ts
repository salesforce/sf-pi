/* SPDX-License-Identifier: Apache-2.0 */
/** Shared types for the SF SOQL lifecycle tool. */

export type SfSoqlAction =
  | "status"
  | "org.preflight"
  | "schema.describe"
  | "schema.relationships"
  | "schema.search"
  | "query.draft"
  | "query.validate"
  | "query.explain"
  | "query.sample"
  | "query.run"
  | "query.count"
  | "query.queryAll"
  | "query.export"
  | "sosl.run"
  | "file.diagnose"
  | "lsp.status"
  | "history.last"
  | "history.rerun";

export type SoqlApiMode = "rest" | "tooling";
export type SoqlOperation = "query" | "queryAll" | "count" | "explain";

export interface SfSoqlParams {
  action: SfSoqlAction;
  target_org?: string;
  query?: string;
  object?: string;
  api?: SoqlApiMode;
  fields?: string[];
  filters?: string[];
  order_by?: string;
  intent?: string;
  file?: string;
  output_file?: string;
  format?: "csv" | "json" | "raw_json" | "flattened_json";
  max_rows?: number;
  limit?: number;
  include_plan?: boolean;
  allow_unbounded?: boolean;
  include_deleted?: boolean;
  output_mode?: "summary" | "inline" | "file_only";
}

export interface SfSoqlSessionState {
  lastRunnable?: SfSoqlParams;
  lastDigest?: SoqlRunDigest;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface DigestRow {
  icon: string;
  label: string;
  value: string;
}

export interface SoqlRunSection {
  icon: string;
  title: string;
  rows: DigestRow[];
}

export interface SoqlApiCallRailItem {
  method: string;
  path: string;
  detail?: string;
}

export interface SoqlArtifact {
  path: string;
  kind: string;
}

export interface SoqlFinding {
  severity: "info" | "warning" | "error";
  icon: string;
  label: string;
  message: string;
}

export interface SoqlQueryShape {
  raw?: string;
  normalized?: string;
  operation?: SoqlOperation;
  api?: SoqlApiMode;
  primary_object?: string;
  fields?: string[];
  relationships?: string[];
  subqueries?: Array<{ relationship: string; fields: string[] }>;
  where_fields?: string[];
  order_by_fields?: string[];
  group_by_fields?: string[];
  having_fields?: string[];
  aliases?: string[];
  bind_variables?: string[];
  type_of_fields?: string[];
  aggregate_fields?: Array<{ fn: string; field?: string }>;
  literal_filters?: Array<{ field: string; operator: string; value: string }>;
  limit?: number;
  all_rows?: boolean;
  header_comments?: string;
  syntax_errors?: Array<{ line: number; column: number; message: string }>;
}

export interface SoqlPlanDigest {
  available: boolean;
  leading_operation_type?: string;
  relative_cost?: number;
  cardinality?: number;
  sobject_cardinality?: number;
  sobject_type?: string;
  fields?: string[];
  verdict?: "selective" | "risky" | "unknown";
  notes?: string[];
}

export interface SoqlResultDigest {
  total_size?: number;
  rows_returned?: number;
  done?: boolean;
  next_records_url?: string;
  columns?: string[];
  sample_rows?: Record<string, string>[];
  duration_ms?: number;
}

export interface SoqlRunDigest {
  action: SfSoqlAction;
  kind: string;
  status: "pass" | "fail" | "warning" | "info";
  icon: string;
  title: string;
  org?: {
    alias?: string;
    api_version?: string;
    user_id?: string;
  };
  meta?: string[];
  query?: SoqlQueryShape;
  validation?: {
    verdict: "safe" | "review" | "risky" | "invalid";
    findings: SoqlFinding[];
  };
  plan?: SoqlPlanDigest;
  result?: SoqlResultDigest;
  api_calls?: SoqlApiCallRailItem[];
  sections: SoqlRunSection[];
  artifacts?: SoqlArtifact[];
  recommended_skills?: string[];
}

export interface SObjectDescribe {
  name: string;
  label?: string;
  queryable?: boolean;
  searchable?: boolean;
  fields: SObjectFieldDescribe[];
  childRelationships?: SObjectChildRelationship[];
}

export interface SObjectFieldDescribe {
  name: string;
  label?: string;
  type?: string;
  relationshipName?: string | null;
  referenceTo?: string[];
  filterable?: boolean;
  groupable?: boolean;
  sortable?: boolean;
  aggregatable?: boolean;
  nillable?: boolean;
  picklistValues?: Array<{ active?: boolean; value?: string; label?: string }>;
}

export interface SObjectChildRelationship {
  childSObject?: string;
  field?: string;
  relationshipName?: string | null;
}

export interface SearchResultRecord {
  [key: string]: unknown;
}

export interface SalesforceSearchResult<T extends SearchResultRecord = SearchResultRecord> {
  searchRecords: T[];
}

export interface QueryResultRecord {
  [key: string]: unknown;
}

export interface SalesforceQueryResult<T extends QueryResultRecord = QueryResultRecord> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}
