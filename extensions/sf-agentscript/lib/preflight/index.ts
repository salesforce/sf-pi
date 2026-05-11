/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Public API for the pre-flight module.
 *
 * Two surfaces:
 *   - `checkBundleType(path)`             local file check (always runs)
 *   - `checkActionTargets(conn, actions)` registry-driven org check
 *
 * The registry implementation dispatches each parsed URI by scheme to a
 * TargetResolver. Schemes not in the registry classify as
 * `unverifiable` — this matches the agentscript compiler's permissive
 * stance ("any scheme is a valid invocation_target_type") while still
 * surfacing the gap to the user.
 */

import type { Connection } from "@salesforce/core";
import type { ComponentSummary } from "../inspect.ts";
import { extractActionTargets } from "./parse.ts";
import { resolverForScheme } from "./registry.ts";
import type { ActionTargetCheck, CheckActionTargetsResult } from "./types.ts";

export { checkBundleType, type BundleTypeCheckResult } from "./bundle-type.ts";
export { extractActionTargets } from "./parse.ts";
export { listResolvers, registeredSchemes } from "./registry.ts";
export type {
  ActionTarget,
  ActionTargetCheck,
  CheckActionTargetsResult,
  TargetResolver,
  TargetStatus,
} from "./types.ts";

/**
 * Verify every action's `target:` URI resolves in the target org. Walks
 * the registry, dispatching each URI by scheme. Resolvers that return a
 * Set tell us which names exist; resolvers that return null mean we
 * couldn't verify. Schemes without a registered resolver are reported
 * as `unverifiable` (publish proceeds, runtime is responsible).
 */
export async function checkActionTargets(
  conn: Connection,
  actions: readonly ComponentSummary[],
): Promise<CheckActionTargetsResult> {
  const targets = extractActionTargets(actions);
  const out: ActionTargetCheck[] = [];
  let resolved = 0;
  let missing = 0;
  let unverifiable = 0;

  // Bucket targets by resolver so we issue one query per resolver group
  // (rather than one per target).
  const buckets = new Map<
    string,
    {
      resolver: ReturnType<typeof resolverForScheme> | undefined;
      indices: number[];
    }
  >();
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const key = t.scheme;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { resolver: resolverForScheme(t.scheme), indices: [] };
      buckets.set(key, bucket);
    }
    bucket.indices.push(i);
  }

  // Pre-resolve each bucket; we read out into the per-target output below.
  const bucketResults = new Map<string, Set<string> | null>();
  for (const [scheme, bucket] of buckets) {
    if (!bucket.resolver) {
      bucketResults.set(scheme, null);
      continue;
    }
    const refNames = bucket.indices.map((i) => targets[i].ref_name);
    const found = await bucket.resolver.resolve(conn, refNames);
    bucketResults.set(scheme, found);
  }

  for (const t of targets) {
    const resolver = resolverForScheme(t.scheme);
    if (!resolver) {
      out.push({
        ...t,
        status: "unverifiable",
        detail: `Scheme '${t.scheme}' is not pre-flighted (no resolver registered).`,
      });
      unverifiable++;
      continue;
    }
    const result = bucketResults.get(t.scheme);
    if (result === null) {
      out.push({
        ...t,
        status: "unverifiable",
        detail: `${resolver.metadataLabel} query failed; cannot confirm '${t.ref_name}' exists.`,
        metadata_label: resolver.metadataLabel,
      });
      unverifiable++;
    } else if (result.has(t.ref_name)) {
      out.push({
        ...t,
        status: "ok",
        metadata_label: resolver.metadataLabel,
      });
      resolved++;
    } else {
      out.push({
        ...t,
        status: "missing",
        detail: `${resolver.metadataLabel} '${t.ref_name}' not found in org.`,
        metadata_label: resolver.metadataLabel,
      });
      missing++;
    }
  }

  return {
    ok: missing === 0,
    targets: out,
    total: targets.length,
    resolved,
    missing,
    unverifiable,
  };
}
