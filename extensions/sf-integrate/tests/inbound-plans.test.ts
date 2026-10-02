/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";

vi.mock("../lib/artifacts.ts", () => ({
  writeIntegrationArtifact: vi.fn(async (kind: string, filename: string) => ({
    path: `/tmp/sf-integrate/${kind}/${filename}`,
    kind,
  })),
}));

const { assertInboundPlanMatches, buildInboundPlan } = await import("../lib/inbound-plans.ts");

const session = {
  target: {
    targetOrg: "IntegrationDev",
    alias: "IntegrationDev",
    username: "integration@example.invalid",
    orgId: "example-org-id",
    instanceUrl: "https://example.develop.my.salesforce.com",
    orgType: "developer",
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest",
  },
} as unknown as SalesforceSession;

describe("inbound ECA plans", () => {
  it("binds every metadata source to the plan hash", async () => {
    const plan = await buildInboundPlan(
      {
        action: "design.plan",
        direction: "inbound",
        eca_flow: "authorization_code_pkce",
        app_name: "ExampleEca",
        callback_url: "https://example.invalid/callback",
      },
      session,
      process.cwd(),
      "admin@example.invalid",
    );

    expect(
      assertInboundPlanMatches(plan, {
        planId: plan.plan_id,
        planHash: plan.plan_hash,
        appName: plan.app_name,
      }),
    ).toBe(plan);

    const global = plan.sources[1];
    if (!global) throw new Error("Missing global OAuth source.");
    plan.sources[1] = {
      ...global,
      source: `${global.source}\n<!-- changed -->`,
    };
    expect(() =>
      assertInboundPlanMatches(plan, {
        planId: plan.plan_id,
        planHash: plan.plan_hash,
        appName: plan.app_name,
      }),
    ).toThrow("contents changed after planning");
  });
});
