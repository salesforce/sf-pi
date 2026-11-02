/* SPDX-License-Identifier: Apache-2.0 */
/** Resolver for `standardInvocableAction://X`.
 *
 * There is no authoritative local lookup for this scheme: native Agentforce
 * actions can be absent from the public Actions API even when Salesforce
 * accepts them, and valid targets also depend on the action's `source:`.
 * Report `unverifiable` instead of inventing absence. Publish validation is the
 * authority and rejects invalid names with an actionable message.
 */

import type { TargetResolver } from "../types.ts";

export const standardInvocableResolver: TargetResolver = {
  schemes: ["standardInvocableAction"],
  metadataLabel: "Standard Invocable Action",
  async resolve() {
    return null;
  },
  async resolveTargets(_conn, targets) {
    return targets.map((target) => ({
      status: "unverifiable" as const,
      reason: "no_authoritative_lookup",
      detail: `standardInvocableAction '${target.ref_name}' is not pre-flighted; Salesforce validates it at publish.`,
    }));
  },
};
