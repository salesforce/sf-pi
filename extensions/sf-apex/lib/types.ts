/* SPDX-License-Identifier: Apache-2.0 */
/** Shared types for the SF Apex lifecycle tool. */

export type SfApexAction =
  | "status"
  | "org.preflight"
  | "apex.search"
  | "test.discover"
  | "test.plan"
  | "coverage.summary"
  | "author.plan"
  | "diagnose.file"
  | "trace.start"
  | "trace.stop"
  | "trace.status"
  | "log.latest"
  | "log.get"
  | "log.analyze"
  | "log.watch"
  | "anon.run"
  | "test.run"
  | "test.result"
  | "test.rerun";

export interface SfApexSessionState {
  lastLogId?: string;
  lastTestRunId?: string;
  lastTestSpec?: {
    tests?: string[];
    class_names?: string[];
    include_coverage?: boolean;
    target_org?: string;
  };
  lastTraceFlagIds?: string[];
}

export interface SfApexParams {
  action: SfApexAction;
  target_org?: string;
  target?: string;
  targets?: string[];
  query?: string;
  test_only?: boolean;
  limit?: number;
  intent?: string;
  file?: string;
  body?: string;
  log_id?: string;
  user_id?: string;
  duration_minutes?: number;
  wait_seconds?: number;
  poll_interval_seconds?: number;
  allow_mutation?: boolean;
  include_coverage?: boolean;
  include_uncovered_lines?: boolean;
  org_wide?: boolean;
  threshold_percent?: number;
  tests?: string[];
  class_names?: string[];
  run_id?: string;
  output_mode?: "summary" | "inline" | "file_only";
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

export interface ApexRunSection {
  icon: string;
  title: string;
  rows: DigestRow[];
}

export interface ApexApiCallRailItem {
  method: string;
  path: string;
  detail?: string;
}

export interface ApexRunDigest {
  action: SfApexAction;
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
  api_calls?: ApexApiCallRailItem[];
  sections: ApexRunSection[];
  artifacts?: ApexArtifact[];
}

export interface ApexLogTimelineEvent {
  offset_ms?: number;
  icon: string;
  kind:
    | "start"
    | "code_unit"
    | "method"
    | "soql"
    | "dml"
    | "flow"
    | "callout"
    | "debug"
    | "exception"
    | "fatal"
    | "limit"
    | "complete";
  label: string;
  detail: string;
  raw?: string;
}

export interface ApexLogDigest {
  log_id?: string;
  operation?: string;
  status?: string;
  start_time?: string;
  duration_ms?: number;
  log_length?: number;
  timeline: ApexLogTimelineEvent[];
  user_debug: Array<{ line?: number; level?: string; message: string; raw: string }>;
  exceptions: Array<{ type?: string; message?: string; raw: string }>;
  fatal_errors: string[];
  limits: Record<string, { used: number; limit: number }>;
  counts: {
    user_debug: number;
    exceptions: number;
    fatal_errors: number;
    soql?: number;
    dml?: number;
    cpu_ms?: number;
    heap_bytes?: number;
  };
}

export interface ApexArtifact {
  path: string;
  kind: string;
}
