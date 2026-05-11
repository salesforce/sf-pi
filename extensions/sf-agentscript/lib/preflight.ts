/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Legacy entry point — preserved so existing imports keep working.
 * The implementation moved to `./preflight/` so each scheme has its
 * own resolver. New code should import from `./preflight/index.ts`
 * directly; this re-export shim is a one-line forwarder.
 */

export {
  checkActionTargets,
  checkBundleType,
  extractActionTargets,
  listResolvers,
  registeredSchemes,
  type ActionTarget,
  type ActionTargetCheck,
  type BundleTypeCheckResult,
  type CheckActionTargetsResult,
  type TargetResolver,
  type TargetStatus,
} from "./preflight/index.ts";
