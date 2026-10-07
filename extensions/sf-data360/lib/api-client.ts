/* SPDX-License-Identifier: Apache-2.0 */
/** Shared Connect REST request planning for the sf_data360 SDK surface. */
import {
  connectSalesforce,
  type SalesforceQueryParams,
  type SalesforceSession,
} from "../../../lib/common/sf-conn/index.ts";
import type { OrgType } from "../../../lib/common/sf-environment/types.ts";
import {
  classifyD360Request,
  normalizeMethod,
  type D360Method,
  type D360SafetyDecision,
} from "./safety.ts";

export interface D360ApiInput {
  method: string;
  path: string;
  query?: SalesforceQueryParams;
  body?: unknown;
  target_org?: string;
  dry_run?: boolean;
  timeout_ms?: number;
  output_mode?: "inline" | "summary" | "file_only";
}

export interface ResolvedData360Request {
  method: D360Method;
  apiPath: string;
  targetOrg: string;
  instanceUrl: string;
  apiVersion: string;
  orgType: OrgType | "unknown";
  safety: D360SafetyDecision;
}

export async function resolveRequestForExecution(
  input: D360ApiInput,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ resolved: ResolvedData360Request; session: SalesforceSession }> {
  const session = await connectSalesforce({
    cwd,
    targetOrg: input.target_org,
    signal,
    timeoutMs: input.timeout_ms,
  });
  return { resolved: resolveRequest(input, session), session };
}

export function resolveRequest(
  input: D360ApiInput,
  session: SalesforceSession,
): ResolvedData360Request {
  const method = normalizeMethod(input.method);
  return {
    method,
    apiPath: session.path(input.path, input.query),
    targetOrg: session.target.targetOrg,
    instanceUrl: session.target.instanceUrl,
    apiVersion: session.target.apiVersion,
    orgType: session.target.orgType,
    safety: classifyD360Request(method, input.path, session.target.orgType),
  };
}

export function responseLooksLikeError(text: string): boolean {
  try {
    return parsedValueLooksLikeError(JSON.parse(text));
  } catch {
    return false;
  }
}

function parsedValueLooksLikeError(parsed: unknown): boolean {
  if (Array.isArray(parsed)) return parsed.some(parsedValueLooksLikeError);
  if (!parsed || typeof parsed !== "object") return false;
  const value = parsed as Record<string, unknown>;
  if (value.error) return true;
  if (Array.isArray(value.errors) && value.errors.length > 0) return true;
  if (typeof value.errorCode === "string" && value.errorCode) return true;
  return typeof value.message === "string" && typeof value.code === "string";
}
