/* SPDX-License-Identifier: Apache-2.0 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type {
  EcaInspection,
  IntegrationAdapter,
  IntegrationDeploymentResult,
  SfIntegrateSessionState,
} from "../lib/types.ts";

vi.mock("../lib/artifacts.ts", () => ({
  integrationArtifactTimestamp: () => "2026-01-01T00-00-00-000Z",
  writeIntegrationArtifact: vi.fn(async (kind: string, filename: string) => ({
    path: `/tmp/sf-integrate/${kind}/${filename}`,
    kind,
  })),
}));

const { applySetup, designPlan, mcpHandoff, orgPreflight } = await import("../lib/operations.ts");

function session(orgType = "developer"): SalesforceSession {
  return {
    target: {
      targetOrg: "IntegrationDev",
      alias: "IntegrationDev",
      orgId: "example-org-id",
      instanceUrl: "https://example.develop.my.salesforce.com",
      orgType: orgType as never,
      apiVersion: "67.0",
      maxApiVersion: "67.0",
      versionSource: "org-latest",
    },
    connection: {} as never,
    identity: vi.fn(async () => ({
      org_id: "example-org-id",
      instance_url: "https://example.develop.my.salesforce.com",
      user_id: "005000000000001AAA",
    })),
    path: vi.fn(),
    request: vi.fn(),
    continueRequest: vi.fn(),
    query: vi.fn(),
  } as unknown as SalesforceSession;
}

function emptyInspection(appName = "SfPiHeadless360Mcp"): EcaInspection {
  return {
    app_name: appName,
    components: {
      ExternalClientApplication: false,
      ExtlClntAppGlobalOauthSettings: false,
      ExtlClntAppOauthSettings: false,
      ExtlClntAppOauthConfigurablePolicies: false,
    },
    metadata_scopes: [],
  };
}

function readyInspection(appName = "SfPiHeadless360Mcp"): EcaInspection {
  return {
    app_name: appName,
    components: {
      ExternalClientApplication: true,
      ExtlClntAppGlobalOauthSettings: true,
      ExtlClntAppOauthSettings: true,
      ExtlClntAppOauthConfigurablePolicies: true,
    },
    metadata_scopes: ["RefreshToken", "MCP"],
    callback_url: "http://localhost:8765/callback",
    pkce_required: true,
    consumer_secret_optional: true,
    named_user_jwt: true,
    refresh_token_rotation: true,
    consumer_key: "public-client-id",
    record_id: "0xI000000000001AAA",
  };
}

function deployment(checkOnly: boolean): IntegrationDeploymentResult {
  return {
    id: checkOnly ? "0Af-check" : "0Af-deploy",
    success: true,
    status: "Succeeded",
    check_only: checkOnly,
    component_failures: [],
    raw: { success: true, checkOnly },
  };
}

function adapter(): IntegrationAdapter {
  let inspections = 0;
  let activationActive = false;
  return {
    describeMetadataTypes: vi.fn(
      async () =>
        new Set([
          "ExternalClientApplication",
          "ExtlClntAppGlobalOauthSettings",
          "ExtlClntAppOauthSettings",
          "ExtlClntAppOauthConfigurablePolicies",
        ]),
    ),
    inspectEca: vi.fn(async () => {
      inspections += 1;
      return inspections <= 2 ? emptyInspection() : readyInspection();
    }),
    inspectMcpServerActivation: vi.fn(async () => ({
      supported: true,
      createable: true,
      updateable: true,
      ...(activationActive
        ? {
            record: {
              id: "example-mcp-access-id",
              developer_name: "platform_headless_360",
              master_label: "headless-360",
              active: true,
            },
          }
        : {}),
    })),
    applyMcpServerActivation: vi.fn(async ({ plan }) => {
      activationActive = true;
      return {
        id: "example-mcp-access-id",
        developer_name: plan.developer_name,
        master_label: plan.master_label,
        active: true,
        operation: plan.operation,
      };
    }),
    deploy: vi.fn(async (input) => deployment(input.checkOnly)),
    resolveContactEmail: vi.fn(async () => "admin@example.invalid"),
  };
}

describe("SF Integrate operations", () => {
  let state: SfIntegrateSessionState;

  beforeEach(() => {
    state = { plans: new Map(), inboundPlans: new Map(), outboundPlans: new Map() };
  });

  it("reports explicit non-production ECA readiness", async () => {
    const result = await orgPreflight(
      { action: "org.preflight", target_org: "IntegrationDev" },
      session(),
      adapter(),
    );

    expect(result.details).toMatchObject({ ok: true, ready: true, mutation_allowed: true });
    expect(result.content[0]?.text).toContain("PASS");
  });

  it("creates a source-bound plan and applies check-only before deploy", async () => {
    const integrationAdapter = adapter();
    const planned = await designPlan(
      {
        action: "design.plan",
        target_org: "IntegrationDev",
        mcp_preset: "headless-360",
      },
      session(),
      state,
      integrationAdapter,
    );
    expect(planned.details).toMatchObject({
      eca_operation: "create",
      activation: { operation: "create", developer_name: "platform_headless_360" },
    });
    const planId = String(planned.details.plan_id);
    const planHash = String(planned.details.plan_hash);

    const applied = await applySetup(
      {
        action: "setup.apply",
        target_org: "IntegrationDev",
        app_name: "SfPiHeadless360Mcp",
        plan_id: planId,
        plan_hash: planHash,
        allow_mutation: true,
      },
      session(),
      state,
      integrationAdapter,
    );

    expect(applied.details).toMatchObject({
      ok: true,
      verified: true,
      activation: { active: true, operation: "create" },
      navigation: {
        path: "/lightning/setup/ManageExternalClientApplication/0xI000000000001/detail",
        url: "https://example.develop.my.salesforce.com/lightning/setup/ManageExternalClientApplication/0xI000000000001/detail",
      },
    });
    expect(applied.content[0]?.text).toContain(
      "Open in Salesforce: https://example.develop.my.salesforce.com/lightning/setup/ManageExternalClientApplication/0xI000000000001/detail",
    );
    expect(integrationAdapter.deploy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ checkOnly: true }),
    );
    expect(integrationAdapter.deploy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ checkOnly: false }),
    );
  });

  it("adopts an exact existing ECA and active hosted server without redeploying", async () => {
    const integrationAdapter = adapter();
    integrationAdapter.inspectEca = vi.fn(async () => readyInspection());
    integrationAdapter.inspectMcpServerActivation = vi.fn(async () => ({
      supported: true,
      createable: true,
      updateable: true,
      record: {
        id: "example-mcp-access-id",
        developer_name: "platform_headless_360",
        master_label: "headless-360",
        active: true,
      },
    }));
    integrationAdapter.applyMcpServerActivation = vi.fn(async ({ plan }) => ({
      ...plan.before!,
      operation: plan.operation,
    }));

    const planned = await designPlan(
      { action: "design.plan", target_org: "IntegrationDev" },
      session(),
      state,
      integrationAdapter,
    );
    expect(planned.details).toMatchObject({
      eca_operation: "adopt",
      activation: { operation: "none" },
    });

    const applied = await applySetup(
      {
        action: "setup.apply",
        target_org: "IntegrationDev",
        app_name: "SfPiHeadless360Mcp",
        plan_id: String(planned.details.plan_id),
        plan_hash: String(planned.details.plan_hash),
        allow_mutation: true,
      },
      session(),
      state,
      integrationAdapter,
    );

    expect(applied.details).toMatchObject({
      verified: true,
      eca_operation: "adopt",
      activation: { operation: "none", active: true },
    });
    expect(integrationAdapter.deploy).not.toHaveBeenCalled();
  });

  it("returns an exact SF Browser fallback when Tooling activation is unavailable", async () => {
    const integrationAdapter = adapter();
    integrationAdapter.inspectMcpServerActivation = vi.fn(async () => ({
      supported: false,
      createable: false,
      updateable: false,
      fallback_reason: "McpServerAccess is unavailable.",
    }));

    const planned = await designPlan(
      { action: "design.plan", target_org: "IntegrationDev" },
      session(),
      state,
      integrationAdapter,
    );
    expect(planned.details).toMatchObject({
      activation: { operation: "browser", fallback_reason: "McpServerAccess is unavailable." },
    });

    const applied = await applySetup(
      {
        action: "setup.apply",
        target_org: "IntegrationDev",
        app_name: "SfPiHeadless360Mcp",
        plan_id: String(planned.details.plan_id),
        plan_hash: String(planned.details.plan_hash),
        allow_mutation: true,
      },
      session(),
      state,
      integrationAdapter,
    );

    expect(applied).toMatchObject({
      isError: true,
      details: {
        verified: false,
        activation: { operation: "browser", active: false },
        activation_navigation: {
          route: { type: "setup", destination: "mcp-servers" },
        },
      },
    });
    expect(integrationAdapter.applyMcpServerActivation).not.toHaveBeenCalled();
  });

  it("refuses a stale plan hash before deployment", async () => {
    const integrationAdapter = adapter();
    const planned = await designPlan(
      { action: "design.plan", target_org: "IntegrationDev" },
      session(),
      state,
      integrationAdapter,
    );

    await expect(
      applySetup(
        {
          action: "setup.apply",
          target_org: "IntegrationDev",
          app_name: "SfPiHeadless360Mcp",
          plan_id: String(planned.details.plan_id),
          plan_hash: "sha256:stale",
          allow_mutation: true,
        },
        session(),
        state,
        integrationAdapter,
      ),
    ).rejects.toThrow("plan_hash");
    expect(integrationAdapter.deploy).not.toHaveBeenCalled();
  });

  it("refuses production even with mutation intent", async () => {
    await expect(
      applySetup(
        {
          action: "setup.apply",
          target_org: "Prod",
          app_name: "SfPiHeadless360Mcp",
          plan_id: "plan_x",
          plan_hash: "sha256:x",
          allow_mutation: true,
        },
        session("production"),
        state,
        adapter(),
      ),
    ).rejects.toThrow("refuses production or unknown");
  });

  it("returns a secret-free MCP handoff with the public consumer key", async () => {
    const handoffAdapter = adapter();
    handoffAdapter.inspectEca = vi.fn(async () => readyInspection());
    handoffAdapter.inspectMcpServerActivation = vi.fn(async () => ({
      supported: true,
      createable: true,
      updateable: true,
      record: {
        id: "example-mcp-access-id",
        developer_name: "platform_headless_360",
        master_label: "headless-360",
        active: true,
      },
    }));
    const handoff = await mcpHandoff(
      {
        action: "mcp.handoff",
        target_org: "IntegrationDev",
        app_name: "SfPiHeadless360Mcp",
      },
      session(),
      handoffAdapter,
    );

    expect(handoff.content[0]?.text).toContain("Consumer key: public-client-id");
    expect(handoff.content[0]?.text).toContain("http://localhost:8765/callback");
    expect(handoff.content[0]?.text).toContain(
      "Open in Salesforce: https://example.develop.my.salesforce.com/lightning/setup/ManageExternalClientApplication/0xI000000000001/detail",
    );
    expect(handoff.details).toMatchObject({
      handoff: {
        server_name: "salesforce-headless-360-integrationdev",
        target: {
          target_org: "IntegrationDev",
          org_id: "example-org-id",
          org_type: "developer",
          host_key: "example.develop",
        },
        activation: { active: true },
      },
      navigation: {
        route: { type: "external-client-app", appName: "SfPiHeadless360Mcp" },
      },
    });
    expect(JSON.stringify(handoff)).not.toContain("client_secret");
  });
});
