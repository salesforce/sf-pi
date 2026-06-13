/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Approval detail formatter tests.
 */
import { describe, expect, it } from "vitest";
import { renderApprovalDetail } from "../lib/approval-detail.ts";
import type { ClassifiedDecision } from "../lib/types.ts";

function productionDeploy(overrides: Partial<ClassifiedDecision> = {}): ClassifiedDecision {
  return {
    ruleId: "sf-deploy-prod",
    feature: "orgAwareGate",
    action: "confirm",
    reason: "Deploy to PRODUCTION org Prod?",
    promptTitle: "PRODUCTION deploy",
    fingerprint: "org=00DPROD|type=production|family=sf project deploy",
    subject: "sf project deploy start -o Prod",
    orgAlias: "Prod",
    orgType: "production",
    orgId: "00DPROD",
    orgUsername: "prod@example.test",
    orgResolutionSource: "lookup",
    approvalScope: {
      fingerprint: "org=00DPROD|type=production|family=sf project deploy",
      label: "production deploys to Prod",
      detail: "Same project, same resolved org, production deploy command family.",
      riskTier: "production_deploy",
      operationFamily: "sf project deploy",
    },
    ...overrides,
  };
}

describe("renderApprovalDetail", () => {
  it("renders Safety Envelope detail for production deploy approvals", () => {
    const detail = renderApprovalDetail(productionDeploy());

    expect(detail).toContain("Risk gate:\n- Org-aware operation (sf-deploy-prod)");
    expect(detail).toContain("Subject:\n- sf project deploy start -o Prod");
    expect(detail).toContain("Target org:");
    expect(detail).toContain("- Alias: Prod");
    expect(detail).toContain("- Type: production via lookup");
    expect(detail).toContain("Approval covers:");
    expect(detail).toContain("- production deploys to Prod");
    expect(detail).toContain("- Operation family: sf project deploy");
    expect(detail).toContain("- Approval duration: current session");
    expect(detail).toContain("Prefer `sf project deploy validate` or `--check-only`");
  });

  it("renders exact-subject envelopes for local dangerous commands", () => {
    const detail = renderApprovalDetail({
      ruleId: "rm-rf",
      feature: "commandGate",
      action: "confirm",
      reason: "Dangerous command: recursive force delete",
      fingerprint: "rm -rf tmp/",
      subject: "rm -rf tmp/",
      approvalScope: {
        fingerprint: "rm -rf tmp/",
        label: "this exact command",
        riskTier: "local_dangerous_exact",
        operationFamily: "rm -rf tmp/",
      },
    });

    expect(detail).toContain("Risk gate:\n- Dangerous command (rm-rf)");
    expect(detail).toContain("- this exact command");
    expect(detail).toContain("- Approval duration: current session");
  });

  it("marks guessed org resolution as fail-closed", () => {
    const detail = renderApprovalDetail(
      productionDeploy({
        orgAlias: "Mystery",
        orgId: undefined,
        orgUsername: undefined,
        orgResolutionGuessed: true,
        orgResolutionSource: "guessed",
        approvalScope: undefined,
      }),
    );

    expect(detail).toContain("- Type: production (guessed fail-closed) via guessed");
    expect(detail).toContain(
      "- Exact subject fingerprint: org=00DPROD|type=production|family=sf project deploy",
    );
  });
});
