/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Public re-exports for the shared skill-detection module.
 *
 * Consumers (sf-skills HUD overlay, future datatable surfaces) should import
 * from this barrel rather than reaching into detection.ts directly.
 */
export { buildSkillInventory, buildSkillsHudState, formatSkillsHudSummary } from "./detection.ts";
export type { SkillEvidence, SkillUsage, SkillsHudState } from "./detection.ts";
