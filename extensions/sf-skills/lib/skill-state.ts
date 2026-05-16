/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Thin re-export of the shared skill-detection module.
 *
 * The implementation lives in lib/common/skill-detection/ so the upcoming
 * sf-skills extension can share the exact same detection logic. Behavior
 * is unchanged from the previous version of this file.
 */
export {
  buildSkillInventory,
  buildSkillsHudState,
  formatSkillsHudSummary,
} from "../../../lib/common/skill-detection/index.ts";
export type {
  SkillEvidence,
  SkillUsage,
  SkillsHudState,
} from "../../../lib/common/skill-detection/index.ts";
