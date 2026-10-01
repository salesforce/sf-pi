/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearMcpTargetAttestations,
  recordMcpTargetAttestation,
  takeMcpTargetAttestation,
} from "../mcp-target-attestation/store.ts";

describe("MCP target attestation store", () => {
  beforeEach(() => clearMcpTargetAttestations());

  it("consumes one matching attestation exactly once", () => {
    recordMcpTargetAttestation({
      sessionId: "session-1",
      serverName: "salesforce-sobject-mutations",
      nextTool: "updateSobjectRecord",
      configFingerprint: "config-1",
      orgId: "00D000000000001AAA",
      isSandbox: true,
      expiresAt: Date.now() + 60_000,
    });

    const input = {
      sessionId: "session-1",
      serverName: "salesforce_sobject_mutations",
      nextTool: "updateSobjectRecord",
      configFingerprint: "config-1",
    };
    expect(takeMcpTargetAttestation(input)).toMatchObject({
      orgId: "00D000000000001AAA",
      isSandbox: true,
    });
    expect(takeMcpTargetAttestation(input)).toBeUndefined();
  });

  it("does not consume an attestation for another tool or configuration", () => {
    recordMcpTargetAttestation({
      sessionId: "session-1",
      serverName: "salesforce-sobject-mutations",
      nextTool: "updateSobjectRecord",
      configFingerprint: "config-1",
      orgId: "00D000000000001AAA",
      isSandbox: true,
      expiresAt: Date.now() + 60_000,
    });

    expect(
      takeMcpTargetAttestation({
        sessionId: "session-1",
        serverName: "salesforce-sobject-mutations",
        nextTool: "createSobjectRecord",
        configFingerprint: "config-1",
      }),
    ).toBeUndefined();
    expect(
      takeMcpTargetAttestation({
        sessionId: "session-1",
        serverName: "salesforce-sobject-mutations",
        nextTool: "updateSobjectRecord",
        configFingerprint: "config-2",
      }),
    ).toBeUndefined();
    expect(
      takeMcpTargetAttestation({
        sessionId: "session-1",
        serverName: "salesforce-sobject-mutations",
        nextTool: "updateSobjectRecord",
        configFingerprint: "config-1",
      }),
    ).toBeDefined();
  });

  it("rejects expired attestations", () => {
    recordMcpTargetAttestation({
      sessionId: "session-1",
      serverName: "salesforce-sobject-mutations",
      nextTool: "updateSobjectRecord",
      configFingerprint: "config-1",
      orgId: "00D000000000001AAA",
      isSandbox: true,
      expiresAt: Date.now() - 1,
    });

    expect(
      takeMcpTargetAttestation({
        sessionId: "session-1",
        serverName: "salesforce-sobject-mutations",
        nextTool: "updateSobjectRecord",
        configFingerprint: "config-1",
      }),
    ).toBeUndefined();
  });
});
