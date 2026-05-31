/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for verified Salesforce route resolution. */
import { describe, expect, it, vi } from "vitest";
import { verifySalesforceRoute } from "../lib/salesforce-route-verifier.ts";

function fakeConnection(options?: {
  recordFound?: boolean;
  listViews?: unknown[];
  relatedLists?: unknown[];
}) {
  return {
    version: "66.0",
    describe: vi.fn(async (objectApiName: string) => ({
      name: objectApiName,
      createable: objectApiName !== "ReadOnly__c",
      queryable: true,
    })),
    query: vi.fn(async () => ({ totalSize: options?.recordFound === false ? 0 : 1, records: [] })),
    request: vi.fn(async (path: string) => {
      if (path.includes("/ui-api/list-info/")) {
        return {
          lists: options?.listViews ?? [
            { id: "00B000000000001AAA", apiName: "AllAccounts", label: "All Accounts" },
          ],
        };
      }
      if (path.includes("/ui-api/related-list-info/")) {
        return {
          relatedLists: options?.relatedLists ?? [
            { relatedListId: "Contacts", label: "Contacts", objectApiName: "Contact" },
          ],
        };
      }
      throw new Error(`Unexpected path ${path}`);
    }),
  };
}

describe("salesforce route verifier", () => {
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
    expect(conn.describe).toHaveBeenCalledWith("Account");
    expect(conn.query).toHaveBeenCalledWith(
      "SELECT Id FROM Account WHERE Id = '001000000000001AAA' LIMIT 1",
    );
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
