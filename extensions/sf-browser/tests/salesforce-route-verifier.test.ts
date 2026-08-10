/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for verified Salesforce route resolution. */
import { describe, expect, it, vi } from "vitest";

const connectSalesforceMock = vi.fn();
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  connectSalesforce: (options: unknown) => connectSalesforceMock(options),
}));

import {
  resolveVerifiedRoutePath,
  verifySalesforceRoute,
} from "../lib/salesforce-route-verifier.ts";

function fakeConnection(options?: {
  recordFound?: boolean;
  listViews?: unknown[];
  relatedLists?: unknown[];
}) {
  const target = {
    targetOrg: "ExampleOrg",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest" as const,
  };
  const describe = vi.fn(async (objectApiName: string) => ({
    name: objectApiName,
    createable: objectApiName !== "ReadOnly__c",
    queryable: true,
  }));
  const query = vi.fn(async () => ({
    totalSize: options?.recordFound === false ? 0 : 1,
    records: [],
    done: true,
    truncated: false,
    target,
  }));
  const request = vi.fn(async (input: { path: string }) => {
    const body = input.path.includes("/ui-api/list-info/")
      ? {
          lists: options?.listViews ?? [
            { id: "00B000000000001AAA", apiName: "AllAccounts", label: "All Accounts" },
          ],
        }
      : {
          relatedLists: options?.relatedLists ?? [
            { relatedListId: "Contacts", label: "Contacts", objectApiName: "Contact" },
          ],
        };
    return { status: 200, body, path: `/services/data/v67.0${input.path}`, target, warnings: [] };
  });
  return {
    target,
    connection: { describe },
    identity: vi.fn(),
    path: vi.fn(),
    request,
    continueRequest: vi.fn(),
    query,
  };
}

describe("salesforce route verifier", () => {
  it("resolves target sessions through the shared Salesforce Connection Module", async () => {
    const session = fakeConnection();
    connectSalesforceMock.mockResolvedValue(session);

    const result = await resolveVerifiedRoutePath(
      "ExampleOrg",
      { type: "object-list", objectApiName: "Account" },
      "/workspace",
    );

    expect(connectSalesforceMock).toHaveBeenCalledWith({
      cwd: "/workspace",
      targetOrg: "ExampleOrg",
    });
    expect(result.path).toBe("/lightning/o/Account/list");
  });

  it("verifies object and record routes", async () => {
    const conn = fakeConnection();

    await expect(
      verifySalesforceRoute(conn as never, { type: "object-list", objectApiName: "Account" }),
    ).resolves.toMatchObject({ path: "/lightning/o/Account/list" });
    await expect(
      verifySalesforceRoute(conn as never, {
        type: "record-view",
        objectApiName: "Account",
        recordId: "001000000000001AAA",
      }),
    ).resolves.toMatchObject({ path: "/lightning/r/Account/001000000000001AAA/view" });
    expect(conn.connection.describe).toHaveBeenCalledWith("Account");
    expect(conn.query).toHaveBeenCalledWith({
      soql: "SELECT Id FROM Account WHERE Id = '001000000000001AAA' LIMIT 1",
      api: "rest",
      maxRows: 1,
    });
  });

  it("resolves list views by label, api name, or id", async () => {
    const conn = fakeConnection();

    await expect(
      verifySalesforceRoute(conn as never, {
        type: "list-view",
        objectApiName: "Account",
        filterName: "All Accounts",
      }),
    ).resolves.toMatchObject({
      path: "/lightning/o/Account/list?filterName=AllAccounts",
      listView: { id: "00B000000000001AAA", apiName: "AllAccounts", label: "All Accounts" },
    });
  });

  it("resolves related lists by label or relatedListId", async () => {
    const conn = fakeConnection();

    await expect(
      verifySalesforceRoute(conn as never, {
        type: "record-related-list",
        objectApiName: "Account",
        recordId: "001000000000001AAA",
        relatedListApiName: "Contacts",
      }),
    ).resolves.toMatchObject({
      path: "/lightning/r/Account/001000000000001AAA/related/Contacts/view",
      relatedList: { relatedListId: "Contacts", label: "Contacts", objectApiName: "Contact" },
    });
  });

  it("fails closed when records are inaccessible or missing", async () => {
    await expect(
      verifySalesforceRoute(fakeConnection({ recordFound: false }) as never, {
        type: "record-view",
        objectApiName: "Account",
        recordId: "001000000000001AAA",
      }),
    ).rejects.toThrow("was not found or is not accessible");
  });

  it("fails closed on ambiguous list view labels", async () => {
    const conn = fakeConnection({
      listViews: [
        { id: "00B000000000001AAA", apiName: "TeamAccounts", label: "Team Accounts" },
        { id: "00B000000000002AAA", apiName: "Team_Accounts", label: "Team Accounts" },
      ],
    });

    await expect(
      verifySalesforceRoute(conn as never, {
        type: "list-view",
        objectApiName: "Account",
        filterName: "Team Accounts",
      }),
    ).rejects.toThrow("ambiguous");
  });
});
