/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();
const requestMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import { D360FacadeParams, runFacade } from "../lib/facade-tool.ts";
import { clearConnectionCache } from "../../../lib/common/sf-conn/connection.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.134.6" },
  project: { detected: true, sourceApiVersion: "66.0" },
  config: { hasTargetOrg: true, targetOrg: "AgentforceSTDM", location: "Global" },
  org: {
    detected: true,
    alias: "AgentforceSTDM",
    username: "agentforce@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "66.0",
  },
  detectedAt: 1,
};

const ctx = { hasUI: false } as never;

describe("d360 capability execution", () => {
  it("keeps the public facade surface capability-shaped", () => {
    const actionSchema = D360FacadeParams.properties.action as unknown as { enum: string[] };
    expect(actionSchema.enum).toEqual(["search", "examples", "execute"]);
    expect(Object.keys(D360FacadeParams.properties)).toEqual(
      expect.arrayContaining(["action", "query", "capability", "variant", "params"]),
    );
    expect(D360FacadeParams.properties).not.toHaveProperty("operation");
    expect(D360FacadeParams.properties).not.toHaveProperty("runbook");

    const publicText = JSON.stringify(D360FacadeParams).toLowerCase();
    expect(publicText).toContain("capability");
    expect(publicText).not.toContain("operation/runbook");
    expect(publicText).not.toContain("registry operation");
  });

  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("resolves examples by capability name", async () => {
    const result = await runFacade(
      {
        action: "examples",
        capability: "agent_observability.stdm_session_timeline",
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "examples",
      capability: expect.objectContaining({
        name: "agent_observability.stdm_session_timeline",
        kind: "runbook",
      }),
      example: expect.objectContaining({
        capability: "agent_observability.stdm_session_timeline",
      }),
    });
  });

  it("resolves upstream payload example variants by canonical capability", async () => {
    const result = await runFacade(
      {
        action: "examples",
        capability: "d360_dmo_create",
        variant: "profile",
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "examples",
      variant: "profile",
      variants: expect.arrayContaining(["profile", "engagement", "other"]),
      example: expect.objectContaining({
        sourceExample: "d360_dmo_create_profile",
        capability: "d360_dmo_create",
        variant: "profile",
        params: expect.objectContaining({
          body: expect.objectContaining({ name: "CustomMetric__dlm" }),
        }),
      }),
    });
  });

  it("executes runbook-backed capabilities through action='execute'", async () => {
    requestMock.mockResolvedValue({
      metadata: [
        { name: "interaction_id" },
        { name: "topic" },
        { name: "trace_id" },
        { name: "turn_started" },
        { name: "who" },
        { name: "text" },
        { name: "sent_at" },
      ],
      data: [["interaction-1", "demo", "trace-1", "start", "Input", "hello", "start"]],
    });

    const result = await runFacade(
      {
        action: "execute",
        capability: "agent_observability.stdm_session_timeline",
        target_org: "AgentforceSTDM",
        params: { session_id: "session-1" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "execute",
      capability: "agent_observability.stdm_session_timeline",
      capabilityKind: "runbook",
      runbook: "agent_observability.stdm_session_timeline",
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/services/data/v66.0/ssot/query-sql?dataspaceName=default",
      }),
    );
  });
});
