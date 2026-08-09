/* SPDX-License-Identifier: Apache-2.0 */
/** Public-tool proof that SF Apex uses the shared Salesforce Connection Module. */

import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";

const connectSalesforceMock = vi.fn();

vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  connectSalesforce: (options: unknown) => connectSalesforceMock(options),
}));

import { registerSfApexTool } from "../lib/sf-apex-tool.ts";

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
    request: vi.fn() as SalesforceSession["request"],
    continueRequest: vi.fn() as SalesforceSession["continueRequest"],
    query: vi.fn(async () => ({
      records: [],
      totalSize: 0,
      done: true,
      truncated: false,
      target,
    })) as SalesforceSession["query"],
  };
}

describe("SF Apex shared connection", () => {
  it("routes a status tool call through connectSalesforce and shared Tooling query", async () => {
    const session = fakeSession();
    connectSalesforceMock.mockReset();
    connectSalesforceMock.mockResolvedValue(session);
    const registerTool = vi.fn();
    registerSfApexTool({ registerTool } as unknown as ExtensionAPI);
    const tool = registerTool.mock.calls[0]?.[0];
    const signal = new AbortController().signal;

    const result = await tool.execute(
      "call-1",
      { action: "status", target_org: "ExampleOrg" },
      signal,
      undefined,
      { cwd: "/workspace" },
    );

    expect(connectSalesforceMock).toHaveBeenCalledWith({
      cwd: "/workspace",
      targetOrg: "ExampleOrg",
      signal,
    });
    expect(session.identity).toHaveBeenCalled();
    expect(session.query).toHaveBeenCalledWith(
      expect.objectContaining({ api: "tooling", maxRows: 50_000 }),
    );
    expect(result.details.digest.org.api_version).toBe("67.0");
    expect(result.content[0].text).toContain("Org API v67.0");
  });
});
