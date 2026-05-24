/* SPDX-License-Identifier: Apache-2.0 */
/** Resolver for `standardInvocableAction://X`.
 *
 * Agent Script accepts the URI scheme syntactically, but publish validates the
 * reference against an org-side restricted picklist of generated function
 * definitions. There is no stable SOQL surface in every org for arbitrary
 * standard invocable names, and treating every name as available produced
 * false-positive preflight results. Until we have a precise org API for this
 * scheme, block it with an actionable diagnostic rather than letting publish
 * fail with a cryptic restricted-picklist error.
 */

import type { TargetResolver } from "../types.ts";

export const standardInvocableResolver: TargetResolver = {
  schemes: ["standardInvocableAction"],
  metadataLabel: "Standard Invocable Action",
  async resolve(_conn, _names) {
    return new Set();
  },
  missingDetail(target) {
    return `standardInvocableAction '${target.ref_name}' cannot be verified as an org-available Agentforce action. Use a concrete flow://, apex://, prompt://, quickAction://, or externalService:// target, or add a resolver once this org exposes a stable API for '${target.ref_name}'.`;
  },
};
