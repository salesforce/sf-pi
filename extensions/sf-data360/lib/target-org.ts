/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Back-compat re-export for Salesforce REST target-org helpers.
 *
 * The implementation lives in `lib/common/sf-rest/target-org.ts` so other
 * bundled extensions can resolve target org/API version context without
 * importing sf-data360 internals.
 */

export {
  normalizeTargetOrg,
  resolveApiVersion,
  resolveExplicitTargetOrg,
  resolveOrgType,
  resolveTargetOrgContext,
  targetMatchesEnvironment,
  type TargetOrgContext,
} from "../../../lib/common/sf-rest/target-org.ts";
