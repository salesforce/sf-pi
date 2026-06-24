/* SPDX-License-Identifier: Apache-2.0 */
/** Cross-extension Herdr handoff contract. */
import type { HerdrExpectedDuration, HerdrPlanIntent, HerdrWorkflowKey } from "./types.ts";

export interface HerdrWorkflowHandoff {
  label: string;
  reason: string;
  commandSource: "owning-extension";
  plan: {
    intent: HerdrPlanIntent;
    primaryWorkflow: HerdrWorkflowKey;
    relatedWorkflows?: HerdrWorkflowKey[];
    expectedDuration?: HerdrExpectedDuration;
  };
}
