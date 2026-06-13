/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Safety Envelope builder tests.
 */
import { describe, expect, it } from "vitest";
import { safetyEnvelopeForCommand, safetyEnvelopeForOrgAware } from "../lib/safety-envelope.ts";
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

describe("Safety Envelope builders", () => {
  it("builds a session-scoped production deploy envelope", () => {
    const envelope = safetyEnvelopeForOrgAware(
      "sf-deploy-prod",
      "sf project deploy start -o Prod",
      org(),
    );

    expect(envelope).toMatchObject({
      fingerprint: "org=00DPROD|type=production|family=sf project deploy",
      label: "production deploys to Prod",
      riskTier: "production_deploy",
      operationFamily: "sf project deploy",
    });
    expect(envelope.persistedGrant).toBeUndefined();
  });

  it("does not persist guessed production deploy envelopes", () => {
    const envelope = safetyEnvelopeForOrgAware(
      "sf-deploy-prod",
      "sf project deploy start -o Mystery",
      org({
        alias: "Mystery",
        orgId: undefined,
        username: undefined,
        guessed: true,
        source: "guessed",
      }),
    );

    expect(envelope.fingerprint).toBe("org=Mystery|type=production|family=sf project deploy");
    expect(envelope.persistedGrant).toBeUndefined();
  });

  it("builds an exact-command envelope for broad local dangerous commands", () => {
    const envelope = safetyEnvelopeForCommand("rm-rf", "rm -rf tmp/");

    expect(envelope).toEqual({
      fingerprint: "rm -rf tmp/",
      label: "this exact command",
      riskTier: "local_dangerous_exact",
      operationFamily: "rm -rf tmp/",
    });
  });

  it("builds a session-scoped envelope for verified non-production org delete", () => {
    const envelope = safetyEnvelopeForCommand(
      "sf-org-delete",
      "sf org delete scratch -o Scratch",
      org({ alias: "Scratch", orgId: "00DSCRATCH", type: "scratch" }),
    );

    expect(envelope).toMatchObject({
      fingerprint: "org=00DSCRATCH|type=scratch|family=sf org delete",
      label: "deleting Scratch",
      riskTier: "nonprod_org_delete",
      operationFamily: "sf org delete",
    });
    expect(envelope.persistedGrant).toBeUndefined();
  });

  it("does not persist production org delete envelopes", () => {
    const envelope = safetyEnvelopeForCommand("sf-org-delete", "sf org delete -o Prod", org());

    expect(envelope.persistedGrant).toBeUndefined();
  });
});
