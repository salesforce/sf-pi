/* SPDX-License-Identifier: Apache-2.0 */

import type { D360OperationSafety } from "../facade/registry.ts";

export type Data360V2ToolName =
  | "data360_discover"
  | "data360_connect"
  | "data360_prepare"
  | "data360_harmonize"
  | "data360_segment"
  | "data360_activate"
  | "data360_query"
  | "data360_semantic"
  | "data360_observe"
  | "data360_orchestrate"
  | "data360_api";

export type Data360V2ImplementationKind =
  | "local"
  | "journey"
  | "tenant_ingest"
  | "tenant_ingest_auth";

export interface Data360V2Endpoint {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
}

export interface Data360V2Implementation {
  kind: Data360V2ImplementationKind;
  name: string;
}

export interface Data360V2ActionDefinition {
  tool: Data360V2ToolName;
  action: string;
  phase: string;
  family: string;
  description: string;
  safety: D360OperationSafety;
  requiredParams: string[];
  optionalParams: string[];
  aliases?: string[];
  tips?: string;
  capability?: string;
  endpoint?: Data360V2Endpoint;
  implementation?: Data360V2Implementation;
}

export interface Data360V2Input {
  tool: Data360V2ToolName;
  action: string;
  params?: Record<string, unknown>;
  target_org?: string;
  dry_run?: boolean;
  allow_confirmed?: boolean;
  timeout_ms?: number;
  output_mode?: "inline" | "summary" | "file_only";
}

export interface Data360V2RecoverVia {
  tool: Data360V2ToolName;
  action: string;
  params?: Record<string, unknown>;
}

export interface Data360V2Step {
  label: string;
  tool: Data360V2ToolName;
  action: string;
  params?: Record<string, unknown>;
  safety?: D360OperationSafety;
  endpoint?: Data360V2Endpoint;
}
