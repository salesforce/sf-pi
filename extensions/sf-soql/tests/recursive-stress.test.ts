/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type { SObjectCatalogEntry, SObjectDescribe } from "../lib/types.ts";
import { inspectQuery, inspectionHasErrors } from "../lib/validator.ts";
import { HISTORICAL_QUERY_REGRESSIONS } from "./fixtures/historical-query-regressions.ts";

const userDescribe: SObjectDescribe = {
  name: "User",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "Name", type: "string", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const nameDescribe: SObjectDescribe = {
  name: "Name",
  queryable: false,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "Name", type: "string", filterable: true, sortable: true },
    { name: "Email", type: "email", filterable: true, sortable: true },
    { name: "Type", type: "picklist", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const rootDescribe: SObjectDescribe = {
  name: "Root__c",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "Name", type: "string", filterable: true, sortable: true },
    { name: "CreatedDate", type: "datetime", filterable: true, sortable: true },
    { name: "Location__c", type: "location", filterable: true, sortable: true },
    {
      name: "OwnerId",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "Owner",
      referenceTo: ["User"],
    },
  ],
  childRelationships: [
    { relationshipName: "Children__r", childSObject: "Child__c", field: "Root__c" },
  ],
};

const childDescribe: SObjectDescribe = {
  name: "Child__c",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "ChildField__c", type: "string", filterable: true, sortable: true },
    {
      name: "Root__c",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "Root__r",
      referenceTo: ["Root__c"],
    },
    {
      name: "OwnerId",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "Owner",
      referenceTo: ["User"],
    },
  ],
  childRelationships: [
    {
      relationshipName: "Grandchildren__r",
      childSObject: "Grandchild__c",
      field: "Child__c",
    },
  ],
};

const grandchildDescribe: SObjectDescribe = {
  name: "Grandchild__c",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "Flag__c", type: "boolean", filterable: true, sortable: true },
    { name: "Score__c", type: "double", filterable: true, sortable: true },
    {
      name: "Child__c",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "Child__r",
      referenceTo: ["Child__c"],
    },
  ],
  childRelationships: [],
};

const otherDescribe: SObjectDescribe = {
  name: "Other__c",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "Name", type: "string", filterable: true, sortable: true },
    { name: "OtherField__c", type: "string", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const activityDescribe: SObjectDescribe = {
  name: "Activity__c",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    {
      name: "WhatId__c",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "What",
      referenceTo: ["Root__c", "Other__c"],
    },
  ],
  childRelationships: [],
};

const DESCRIBES = new Map<string, SObjectDescribe>([
  ["Root__c", rootDescribe],
  ["Child__c", childDescribe],
  ["Grandchild__c", grandchildDescribe],
  ["Activity__c", activityDescribe],
  ["Other__c", otherDescribe],
  ["User", userDescribe],
  ["Name", nameDescribe],
]);

function fakeSession(): SalesforceSession {
  const target = Object.freeze({
    targetOrg: "ExampleOrg",
    alias: "ExampleOrg",
    username: "user@example.invalid",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "67.0",
    maxApiVersion: "67.0",
    versionSource: "org-latest" as const,
  });
  const catalog: SObjectCatalogEntry[] = [...DESCRIBES.values()]
    .filter((entry) => entry.name !== "Name")
    .map((entry) => ({ name: entry.name, queryable: true }));
  return {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(),
    path: vi.fn((resource: string) => `/services/data/v67.0${resource}`),
    request: vi.fn(async (input) => {
      let status = 200;
      let body: unknown;
      if (input.path === "/sobjects") body = { sobjects: catalog };
      else if (input.path === "/tooling/sobjects") body = { sobjects: [] };
      else {
        const match = /^\/sobjects\/([^/]+)\/describe$/.exec(input.path);
        const describe = match ? DESCRIBES.get(decodeURIComponent(match[1])) : undefined;
        if (describe) body = describe;
        else {
          status = 404;
          body = [{ errorCode: "NOT_FOUND", message: "Synthetic schema not found." }];
        }
      }
      return {
        status,
        body,
        path: `/services/data/v67.0${input.path}`,
        target,
        warnings: [],
      };
    }) as SalesforceSession["request"],
    continueRequest: vi.fn() as SalesforceSession["continueRequest"],
    query: vi.fn() as SalesforceSession["query"],
  };
}

describe("SF SOQL recursive stress validation", () => {
  it("validates nested child subqueries across three object levels", async () => {
    const inspection = await inspectQuery(
      fakeSession(),
      {
        action: "query.validate",
        target_org: "ExampleOrg",
        query:
          "SELECT Id, (SELECT Id, Root__r.Owner.Name, (SELECT Id, Flag__c FROM Grandchildren__r WHERE Flag__c = true ORDER BY Score__c DESC LIMIT 2) FROM Children__r WHERE ChildField__c != null LIMIT 3) FROM Root__c LIMIT 1",
      },
      {},
    );

    expect(inspectionHasErrors(inspection)).toBe(false);
  });

  it("finds an invalid field at the deepest child-subquery level", async () => {
    const inspection = await inspectQuery(
      fakeSession(),
      {
        action: "query.validate",
        target_org: "ExampleOrg",
        query:
          "SELECT Id, (SELECT Id, (SELECT Id FROM Grandchildren__r WHERE DeeplyMissing__c = true LIMIT 2) FROM Children__r LIMIT 3) FROM Root__c LIMIT 1",
      },
      {},
    );

    expect(inspection.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: "DeeplyMissing__c does not exist on Grandchild__c.",
        }),
      ]),
    );
  });

  it("recursively validates nested semi-join query shapes", async () => {
    const inspection = await inspectQuery(
      fakeSession(),
      {
        action: "query.validate",
        target_org: "ExampleOrg",
        query:
          "SELECT Id FROM Root__c WHERE Id IN (SELECT Root__c FROM Child__c WHERE Id IN (SELECT Child__c FROM Grandchild__c WHERE DeeplyMissing__c = true)) LIMIT 1",
      },
      {},
    );

    expect(inspection.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          message: "DeeplyMissing__c does not exist on Grandchild__c.",
        }),
      ]),
    );
  });

  it.each(HISTORICAL_QUERY_REGRESSIONS)("locks historical category: $name", async (fixture) => {
    const inspection = await inspectQuery(
      fakeSession(),
      { action: "query.validate", target_org: "ExampleOrg", query: fixture.query },
      {},
    );
    expect(inspectionHasErrors(inspection)).toBe(fixture.expected === "fail");
    if (fixture.expectedMessage) {
      expect(
        inspection.findings.some((finding) =>
          finding.message.includes(fixture.expectedMessage as string),
        ),
      ).toBe(true);
    }
  });
});
