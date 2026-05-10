/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Eval API client — POST /einstein/evaluation/v1/tests.
 *
 * Constraints:
 *  - Hard limit of 5 tests per request (Salesforce-side cap).
 *  - The endpoint requires the full set of SFAP context headers (org, user,
 *    instance, app context, feature id) plus an x-sfdc-core-tenant-id derived
 *    from the org id. We resolve those once per run and reuse for all batches.
 */

import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";
import { httpCall, type HttpResponse } from "./http.ts";
import type { EvalApiResponse, EvalTest } from "./types.ts";

export const EVAL_URL = "https://api.salesforce.com/einstein/evaluation/v1/tests";
export const EVAL_BATCH_SIZE = 5;

export interface EvalApiHeaders {
  orgId: string;
  userId: string;
  instanceUrl: string;
}

/**
 * Build the custom-header set the eval API requires. The Authorization header
 * is supplied automatically by `sf api request rest` from the active org's
 * auth context.
 */
export function buildEvalHeaders(h: EvalApiHeaders): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-sfdc-core-tenant-id": `core/prod/${h.orgId}`,
    "x-org-id": h.orgId,
    "x-sfdc-core-instance-url": h.instanceUrl,
    "x-sfdc-user-id": h.userId,
    "x-client-feature-id": "AIPlatformEvaluation",
    "x-sfdc-app-context": "EinsteinGPT",
  };
}

/**
 * POST a single batch (≤ 5 tests). Returns the raw response. The HTTP status
 * is included in the response object so callers can decide how to surface
 * partial failures.
 */
export async function callEval(
  exec: ExecFn,
  tests: EvalTest[],
  targetOrg: string,
  headers: EvalApiHeaders,
  opts?: { timeoutMs?: number },
): Promise<HttpResponse<EvalApiResponse>> {
  return httpCall<EvalApiResponse>(exec, {
    url: EVAL_URL,
    method: "POST",
    targetOrg,
    headers: buildEvalHeaders(headers),
    body: { tests },
    timeoutMs: opts?.timeoutMs ?? 300_000,
    maxRetries: 2,
    fallback: true,
  });
}

/** Split a list of tests into ≤ 5-test batches. */
export function splitIntoBatches(tests: EvalTest[]): EvalTest[][] {
  const out: EvalTest[][] = [];
  for (let i = 0; i < tests.length; i += EVAL_BATCH_SIZE) {
    out.push(tests.slice(i, i + EVAL_BATCH_SIZE));
  }
  return out;
}
