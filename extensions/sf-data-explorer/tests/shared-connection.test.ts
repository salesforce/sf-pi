/* SPDX-License-Identifier: Apache-2.0 */
/** Transport proof that Data Explorer uses the shared Salesforce Connection Module. */

import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";

const connectSalesforceMock = vi.fn();
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  connectSalesforce: (options: unknown) => connectSalesforceMock(options),
}));

import { getSfDataExplorerTransport } from "../lib/transport.ts";

function fakeSession(): SalesforceSession {
  const target = Object.freeze({
    targetOrg: "ExampleOrg",
    alias: "ExampleOrg",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest" as const,
  });
  return {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(),
    path: vi.fn((resource: string) => `/services/data/v67.0${resource}`),
    request: vi.fn(async (input) => ({
      status: 200,
      body: { totalSize: 0, done: true, records: [] },
      path: `/services/data/v67.0${input.path}?q=SELECT+Id+FROM+Account`,
      target,
      warnings: [],
    })) as SalesforceSession["request"],
    continueRequest: vi.fn() as SalesforceSession["continueRequest"],
    query: vi.fn() as SalesforceSession["query"],
  };
}

describe("SF Data Explorer shared connection", () => {
  it("resolves and executes SOQL through one shared session", async () => {
    const sf = fakeSession();
    connectSalesforceMock.mockResolvedValue(sf);
    const transport = await getSfDataExplorerTransport({} as never, "/workspace");
    const signal = new AbortController().signal;

    const result = await transport.querySoql({
      targetOrg: "ExampleOrg",
      soql: "SELECT Id FROM Account",
      timeoutMs: 10_000,
      signal,
    });

    expect(connectSalesforceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/workspace",
        targetOrg: "ExampleOrg",
        signal,
        timeoutMs: 10_000,
      }),
    );
    expect(sf.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/query",
        query: { q: "SELECT Id FROM Account" },
      }),
    );
    expect(result.context).toEqual({
      targetOrg: "ExampleOrg",
      apiVersion: "67.0",
      orgType: "sandbox",
    });
    expect(result.path).toContain("/services/data/v67.0/query");
  });

  it("forwards authoritative cwd when the target comes from Salesforce configuration", async () => {
    const sf = fakeSession();
    connectSalesforceMock.mockClear();
    connectSalesforceMock.mockResolvedValue(sf);
    const transport = await getSfDataExplorerTransport({} as never, "/workspace");

    await transport.resolveTarget();

    expect(connectSalesforceMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/workspace", targetOrg: undefined }),
    );
  });
});
