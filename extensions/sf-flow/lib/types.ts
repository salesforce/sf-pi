/* SPDX-License-Identifier: Apache-2.0 */
/** Shared contracts for the lean SF Flow lifecycle. */

export type SfFlowAction =
  | "status"
  | "org.preflight"
  | "project.scan"
  | "flow.inspect"
  | "author.plan"
  | "diagnose.file"
  | "quality.rules"
  | "fix.apply"
  | "validate.check"
  | "lifecycle.status"
  | "deploy.activate"
  | "lifecycle.activate"
  | "lifecycle.deactivate"
  | "test.discover"
  | "test.plan"
  | "test.run"
  | "test.result"
  | "test.rerun";

export type FlowFamily =
  | "screen"
  | "autolaunched"
  | "record-triggered"
  | "schedule-triggered"
  | "platform-event-triggered"
  | "omni-channel"
  | "specialized"
  | "unknown";

export type TriggerTiming = "before-save" | "after-save" | "before-delete";
export type OmniDestination = "queue" | "agent" | "skills";
export type FlowSeverity = "high" | "moderate" | "low" | "info";

export interface SfFlowParams {
  action: SfFlowAction;
  target_org?: string;
  workspace?: string;
  file?: string;
  flow_name?: string;
  version?: number;
  allow_mutation?: boolean;
  intent?: string;
  flow_type?: Exclude<FlowFamily, "specialized" | "unknown">;
  omni_destination?: OmniDestination;
  omni_check_availability?: boolean;
  omni_no_route?: boolean;
  object?: string;
  event?: string;
  trigger_timing?: TriggerTiming;
  record_event?: "create" | "update" | "create-and-update" | "delete";
  flow_names?: string[];
  tests?: string[];
  run_id?: string;
  fix_id?: string;
  source_version?: string;
  wait_seconds?: number;
  include_coverage?: boolean;
  report_formats?: string[];
  quality_profile?: "generation" | "review" | "audit";
  limit?: number;
}

export interface SfFlowSessionState {
  last_test_run_id?: string;
  last_test_spec?: {
    target_org?: string;
    flow_names?: string[];
    tests?: string[];
    wait_seconds?: number;
    include_coverage?: boolean;
    report_formats?: string[];
  };
}

export interface FlowFinding {
  rule_id: string;
  severity: FlowSeverity;
  message: string;
  line: number;
  column: number;
  end_line?: number;
  end_column?: number;
  element?: string;
}

export interface FlowCoverage {
  ran: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export interface FlowElement {
  id: string;
  name: string;
  kind: string;
  label?: string;
  detail?: string;
  line: number;
  column: number;
}

export interface FlowConnector {
  from: string;
  to?: string;
  kind: string;
  label?: string;
  fault: boolean;
  line: number;
  column: number;
}

export interface FlowResource {
  name: string;
  kind: string;
  line: number;
  column: number;
  input?: boolean;
  output?: boolean;
}

export interface FlowModel {
  file: string;
  label?: string;
  api_version?: string;
  process_type?: string;
  trigger_type?: string;
  record_trigger_type?: string;
  object?: string;
  start_criteria?: string[];
  family: FlowFamily;
  elements: FlowElement[];
  connectors: FlowConnector[];
  resources: FlowResource[];
  references: Array<{ value: string; line: number; column: number; owner?: string }>;
}

export interface FlowAnalysis {
  file: string;
  status: "clean" | "findings" | "failed";
  family: FlowFamily;
  findings: FlowFinding[];
  summary: Record<FlowSeverity, number>;
  coverage: FlowCoverage;
  model?: FlowModel;
}

export interface FlowArtifact {
  path: string;
  kind: string;
}

export interface DigestRow {
  icon: string;
  label: string;
  value: string;
}

export interface FlowRunSection {
  icon: string;
  title: string;
  rows: DigestRow[];
}

export interface FlowTopologyDigest {
  mermaid: string;
  nodes: number;
  total_nodes: number;
  edges: number;
  truncated: boolean;
}

export interface FlowRunDigest {
  action: SfFlowAction;
  kind: string;
  status: "pass" | "fail" | "warning" | "info";
  icon: string;
  title: string;
  org?: { alias?: string; api_version?: string };
  meta?: string[];
  rail?: Array<{ kind: string; target: string; detail?: string }>;
  sections: FlowRunSection[];
  topology?: FlowTopologyDigest;
  artifacts?: FlowArtifact[];
  next_step?: string;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}
