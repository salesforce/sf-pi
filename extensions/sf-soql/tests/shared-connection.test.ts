/* SPDX-License-Identifier: Apache-2.0 */
/** Public-tool proof that SF SOQL uses the shared Salesforce Connection Module. */

import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";

const connectSalesforceMock = vi.fn();

vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  connectSalesforce: (options: unknown) => connectSalesforceMock(options),
}));

import { registerSfSoqlTool } from "../lib/sf-soql-tool.ts";

function fakeSession(): SalesforceSession {
  const target = Object.freeze({
    targetOrg: "ExampleOrg",
    alias: "ExampleOrg",
    username: "user@example.invalid",
    orgId: "00D000000000001AAA",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest" as const,
  });
  return {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(async () => ({
      org_id: "00D000000000001AAA",
      instance_url: target.instanceUrl,
      user_id: "005000000000001AAA",
    })),
    path: vi.fn((resource: string) => `/services/data/v67.0${resource}`),
    request: vi.fn(async (input) => ({
      status: 200,
      body: {
        sobjects: [
          { name: "Account", label: "Account", queryable: true },
          { name: "Contact", label: "Contact", queryable: true },
        ],
      },
      path: `/services/data/v67.0${input.path}`,
      target,
      warnings: [],
    })) as SalesforceSession["request"],
    query: vi.fn() as SalesforceSession["query"],
  };
}

describe("SF SOQL shared connection", () => {
  it("routes a schema.search tool call through connectSalesforce and versionless resources", async () => {
    const session = fakeSession();
    connectSalesforceMock.mockReset();
    connectSalesforceMock.mockResolvedValue(session);
    const registerTool = vi.fn();
    registerSfSoqlTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const signal = new AbortController().signal;

    const result = await tool.execute(
      "call-1",
      { action: "schema.search", query: "acc", target_org: "ExampleOrg", limit: 5 },
      signal,
      undefined,
      { cwd: "/workspace" },
    );

    expect(connectSalesforceMock).toHaveBeenCalledWith({
      cwd: "/workspace",
      targetOrg: "ExampleOrg",
      signal,
    });
    expect(session.request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/sobjects" }),
    );
    expect(result.details.digest.org.api_version).toBe("67.0");
    expect(result.details.digest.api_calls[0].path).toBe("/services/data/v67.0/sobjects");
    expect(result.content[0].text).toContain("matches=1");
  });
});
