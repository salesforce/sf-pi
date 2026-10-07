/* SPDX-License-Identifier: Apache-2.0 */
import type { D360OperationSafety } from "../operation-registry.ts";

export type Data360Namespace =
  | "discover"
  | "connect"
  | "prepare"
  | "harmonize"
  | "segment"
  | "activate"
  | "query"
  | "semantic"
  | "observe"
  | "orchestrate"
  | "api";

/** Internal execution ownership is the same stable business namespace. */
export type Data360ActionOwner = Data360Namespace;

export type Data360ImplementationKind =
  "local" | "journey" | "tenant_ingest" | "tenant_ingest_auth";

export interface Data360Endpoint {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
}

export interface Data360Implementation {
  kind: Data360ImplementationKind;
  name: string;
}

/** Generated single-tool action contract. */
export interface Data360ActionDefinition {
  namespace: Data360Namespace;
  action: string;
  internalOwner: Data360ActionOwner;
  internalAction: string;
  phase: string;
  family: string;
  promotionWave?: string;
  description: string;
  safety: D360OperationSafety;
  requiredParams: string[];
  optionalParams: string[];
  requiredAnyOf?: string[][];
  inputSchema?: Record<string, unknown>;
  aliases?: string[];
  tips?: string;
  operationId?: string;
  operationAliases?: string[];
  capability?: string;
  endpoint?: Data360Endpoint;
  implementation?: Data360Implementation;
}

/** Internal dispatcher view over a generated action. */
export interface Data360InternalActionDefinition {
  tool: Data360ActionOwner;
  action: string;
  publicAction?: string;
  namespace?: Data360Namespace;
  phase: string;
  family: string;
  promotionWave?: string;
  description: string;
  safety: D360OperationSafety;
  requiredParams: string[];
  optionalParams: string[];
  requiredAnyOf?: string[][];
  inputSchema?: Record<string, unknown>;
  aliases?: string[];
  tips?: string;
  capability?: string;
  endpoint?: Data360Endpoint;
  implementation?: Data360Implementation;
}

export interface SfData360Input {
  action: string;
  params?: Record<string, unknown>;
  target_org?: string;
  dry_run?: boolean;
  allow_mutation?: boolean;
  timeout_ms?: number;
  output_mode?: "inline" | "summary" | "file_only";
}

export interface Data360InternalInput {
  tool: Data360ActionOwner;
  action: string;
  params?: Record<string, unknown>;
  target_org?: string;
  dry_run?: boolean;
  allow_mutation?: boolean;
  timeout_ms?: number;
  output_mode?: "inline" | "summary" | "file_only";
}

export interface Data360RecoverVia {
  tool: Data360ActionOwner;
  action: string;
  params?: Record<string, unknown>;
}

export interface Data360Step {
  label: string;
  tool: Data360ActionOwner;
  action: string;
  params?: Record<string, unknown>;
  safety?: D360OperationSafety;
  endpoint?: Data360Endpoint;
}
