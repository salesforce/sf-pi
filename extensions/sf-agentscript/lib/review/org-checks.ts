/* SPDX-License-Identifier: Apache-2.0 */
/** Target-org checks for deterministic Agent Script review. */

import type { Connection } from "@salesforce/core";
import { checkAgentUserStatus } from "../agent-user/status.ts";
import type { AgentFeatureProfile } from "../feature-profile.ts";
import type { ComponentSummary } from "../inspect.ts";
import { checkActionTargets } from "../preflight.ts";
import { checkSurfaceReadiness } from "../preflight/surface-readiness.ts";
import type { ReviewFinding } from "./types.ts";

export interface CollectOrgReviewFindingsInput {
  conn: Connection;
  actions: ComponentSummary[];
  profile: AgentFeatureProfile;
  config: Record<string, unknown>;
  agentFile: string;
  targetOrg: string;
  phoneNumber?: string;
}

export async function collectOrgReviewFindings(
  input: CollectOrgReviewFindingsInput,
): Promise<ReviewFinding[]> {
  const findings: ReviewFinding[] = [];
  const targets = await checkActionTargets(input.conn, input.actions);
  for (const target of targets.targets) {
    if (target.status === "missing") {
      findings.push({
        id: `target-missing-${target.name}`,
        severity: "blocker",
        category: "org",
        message: `Action target missing in org: ${target.name} → ${target.target}`,
        evidence: target.detail ? [target.detail] : undefined,
      });
    } else if (target.status === "unverifiable") {
      findings.push({
        id: `target-unverifiable-${target.name}`,
        severity: "warning",
        category: "org",
        message: `Action target could not be verified: ${target.name} → ${target.target}`,
        evidence: target.detail ? [target.detail] : undefined,
      });
    }
  }

  const agentType =
    typeof input.config.agent_type === "string" ? input.config.agent_type : undefined;
  const defaultAgentUser =
    typeof input.config.default_agent_user === "string"
      ? input.config.default_agent_user
      : undefined;
  if (agentType === "AgentforceServiceAgent") {
    const userStatus = await checkAgentUserStatus(input.conn, {
      agent_type: agentType,
      default_agent_user: defaultAgentUser,
    });
    if (!userStatus.ok) {
      findings.push({
        id: `agent-user-${userStatus.reason ?? "not-ready"}`,
        severity: "blocker",
        category: "org",
        message: userStatus.short_message,
        recover_via: {
          tool: "agentscript_lifecycle",
          params: {
            action: "diagnose_agent_user",
            agent_file: input.agentFile,
            target_org: input.targetOrg,
          },
        },
      });
    }
  }

  const agentApiName =
    typeof input.config.agent_name === "string" ? input.config.agent_name : undefined;
  const surfaceChecks = await checkSurfaceReadiness(input.conn, input.profile, {
    agentApiName,
    phoneNumber: input.phoneNumber,
  });
  for (const check of surfaceChecks) {
    if (check.status === "ok") continue;
    findings.push({
      id: `surface-${check.code}`,
      severity: check.status === "blocker" ? "blocker" : "warning",
      category: "org",
      message: check.message,
      evidence: check.evidence,
    });
  }

  return findings;
}
