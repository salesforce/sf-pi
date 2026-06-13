/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { approvalScopeForCommand, approvalScopeForOrgAware } from "../lib/approval-scope.ts";
import type { OrgContext } from "../lib/org-context.ts";

function org(overrides: Partial<OrgContext> = {}): OrgContext {
  return {
    alias: "Prod",
    orgId: "00DPROD",
    username: "prod@example.test",
    type: "production",
    guessed: false,
    explicit: true,
    source: "lookup",
    ...overrides,
  };
}

describe("approval scope", () => {
  it("builds a session-scoped production deploy scope", () => {
    const scope = approvalScopeForOrgAware(
      "sf-deploy-prod",
      "sf project deploy start -o Prod",
      org(),
    );
    expect(scope.fingerprint).toBe("org=00DPROD|type=production|family=sf project deploy");
    expect(scope.persistedGrant).toBeUndefined();
  });

  it("does not persist guessed production deploy grants", () => {
    const scope = approvalScopeForOrgAware(
      "sf-deploy-prod",
      "sf project deploy start -o Mystery",
      org({ alias: "Mystery", orgId: undefined, guessed: true, source: "guessed" }),
    );
    expect(scope.persistedGrant).toBeUndefined();
  });

  it("builds a session-scoped verified non-production org delete scope", () => {
    const scope = approvalScopeForCommand(
      "sf-org-delete",
      "sf org delete scratch -o Scratch",
      org({ alias: "Scratch", orgId: "00DSCRATCH", type: "scratch" }),
    );
    expect(scope.fingerprint).toBe("org=00DSCRATCH|type=scratch|family=sf org delete");
    expect(scope.persistedGrant).toBeUndefined();
  });

  it("does not persist production org delete grants", () => {
    const scope = approvalScopeForCommand("sf-org-delete", "sf org delete -o Prod", org());
    expect(scope.persistedGrant).toBeUndefined();
  });
});
