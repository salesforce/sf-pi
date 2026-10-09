/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type { SObjectDescribe, SoqlRunDigest, ToolResult } from "../lib/types.ts";

interface SfSoqlTestResult extends ToolResult {
  details: { digest: SoqlRunDigest; [key: string]: unknown };
}

interface RegisteredSfSoqlTool {
  execute(
    id: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: undefined,
    context: { cwd: string },
  ): Promise<SfSoqlTestResult>;
}

const connectSalesforceMock = vi.fn();

vi.mock("../../../lib/common/sf-conn/index.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/common/sf-conn/index.ts")>();
  return {
    ...actual,
    connectSalesforce: (options: unknown) => connectSalesforceMock(options),
  };
});

import { registerSfSoqlTool } from "../lib/sf-soql-tool.ts";

const accountDescribe: SObjectDescribe = {
  name: "Account",
  label: "Account",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "Name", type: "string", filterable: true, sortable: true },
    {
      name: "OwnerId",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "Owner",
      referenceTo: ["User"],
    },
    { name: "Description", type: "textarea", filterable: false, sortable: false },
    {
      name: "CreatedDate",
      type: "datetime",
      filterable: true,
      sortable: true,
      groupable: false,
    },
    { name: "Industry", type: "picklist", filterable: true, sortable: true },
    { name: "Location__c", type: "location", filterable: false, sortable: false },
  ],
  childRelationships: [
    { relationshipName: "Contacts", childSObject: "Contact", field: "AccountId" },
  ],
};

const contactDescribe: SObjectDescribe = {
  name: "Contact",
  label: "Contact",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    {
      name: "AccountId",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "Account",
      referenceTo: ["Account"],
    },
    {
      name: "OwnerId",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "Owner",
      referenceTo: ["User"],
    },
    { name: "Email", type: "email", filterable: true, sortable: true },
    { name: "BuyerAttributes", type: "multipicklist", filterable: true, sortable: false },
  ],
  childRelationships: [],
};

const taskDescribe: SObjectDescribe = {
  name: "Task",
  label: "Task",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    {
      name: "WhatId",
      type: "reference",
      filterable: true,
      sortable: true,
      relationshipName: "What",
      referenceTo: ["Account", "Opportunity"],
    },
  ],
  childRelationships: [],
};

const nameDescribe: SObjectDescribe = {
  name: "Name",
  label: "Name",
  queryable: false,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "Name", type: "string", filterable: true, sortable: true },
    { name: "Email", type: "email", filterable: true, sortable: true },
    { name: "Type", type: "picklist", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const opportunityDescribe: SObjectDescribe = {
  name: "Opportunity",
  label: "Opportunity",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true, custom: false },
    { name: "Name", type: "string", filterable: true, sortable: true, custom: false },
    {
      name: "StageName",
      type: "picklist",
      filterable: true,
      sortable: true,
      custom: false,
    },
    { name: "Amount", type: "currency", filterable: true, sortable: true, custom: false },
    {
      name: "ExpectedRevenue",
      type: "currency",
      filterable: true,
      sortable: true,
      custom: false,
    },
    { name: "CloseDate", type: "date", filterable: true, sortable: true, custom: false },
    {
      name: "CreatedDate",
      type: "datetime",
      filterable: true,
      sortable: true,
      custom: false,
    },
  ],
  childRelationships: [],
};

const userDescribe: SObjectDescribe = {
  name: "User",
  label: "User",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true, custom: false },
    { name: "Name", type: "string", filterable: true, sortable: true, custom: false },
  ],
  childRelationships: [],
};

const contentDocumentLinkDescribe: SObjectDescribe = {
  name: "ContentDocumentLink",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "ContentDocumentId", type: "reference", filterable: true, sortable: true },
    { name: "LinkedEntityId", type: "reference", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const voteDescribe: SObjectDescribe = {
  name: "Vote",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "ParentId", type: "reference", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const toolingDescribe: SObjectDescribe = {
  name: "ToolOnly",
  label: "Tool Only",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "ToolingField", type: "string", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const restOverlapDescribe: SObjectDescribe = {
  name: "BothObject",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "RestField", type: "string", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

const toolingOverlapDescribe: SObjectDescribe = {
  name: "BothObject",
  queryable: true,
  fields: [
    { name: "Id", type: "id", filterable: true, sortable: true },
    { name: "ToolingField", type: "string", filterable: true, sortable: true },
  ],
  childRelationships: [],
};

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
  const describes = new Map<string, SObjectDescribe>([
    ["/sobjects/Account/describe", accountDescribe],
    ["/sobjects/Contact/describe", contactDescribe],
    ["/sobjects/Task/describe", taskDescribe],
    ["/sobjects/Name/describe", nameDescribe],
    ["/sobjects/Opportunity/describe", opportunityDescribe],
    ["/sobjects/User/describe", userDescribe],
    ["/sobjects/ContentDocumentLink/describe", contentDocumentLinkDescribe],
    ["/sobjects/Vote/describe", voteDescribe],
    ["/sobjects/BothObject/describe", restOverlapDescribe],
    ["/tooling/sobjects/ToolOnly/describe", toolingDescribe],
    ["/tooling/sobjects/BothObject/describe", toolingOverlapDescribe],
  ]);
  return {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(async () => ({
      org_id: target.orgId,
      instance_url: target.instanceUrl,
      user_id: "005000000000001AAA",
    })),
    path: vi.fn((resource: string) => `/services/data/v67.0${resource}`),
    request: vi.fn(async (input) => {
      let status = 200;
      let body: unknown;
      if (input.path === "/sobjects") {
        body = {
          sobjects: [
            { name: "Account", label: "Account", queryable: true },
            { name: "Contact", label: "Contact", queryable: true },
            { name: "Task", label: "Task", queryable: true },
            { name: "Opportunity", label: "Opportunity", queryable: true },
            { name: "User", label: "User", queryable: true },
            { name: "ContentDocumentLink", label: "Content Document Link", queryable: true },
            { name: "Vote", label: "Vote", queryable: true },
            { name: "BothObject", label: "Both Object", queryable: true },
          ],
        };
      } else if (input.path === "/tooling/sobjects") {
        body = {
          sobjects: [
            { name: "ToolOnly", label: "Tool Only", queryable: true },
            { name: "BothObject", label: "Both Object", queryable: true },
          ],
        };
      } else if (describes.has(input.path)) {
        body = describes.get(input.path);
      } else {
        status = 404;
        body = [{ errorCode: "NOT_FOUND", message: `No schema at ${input.path}` }];
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
    query: vi.fn(async () => ({
      records: [{ Id: "001000000000001AAA" }],
      totalSize: 1,
      done: true,
      truncated: false,
      target,
    })) as SalesforceSession["query"],
  };
}

async function registeredTool(session: SalesforceSession) {
  connectSalesforceMock.mockReset();
  connectSalesforceMock.mockResolvedValue(session);
  const registerTool = vi.fn();
  registerSfSoqlTool({ registerTool } as unknown as ExtensionAPI);
  const tool = registerTool.mock.calls[0]?.[0];
  if (!tool) throw new Error("SF SOQL tool was not registered.");
  return tool as RegisteredSfSoqlTool;
}

async function execute(tool: RegisteredSfSoqlTool, args: Record<string, unknown>) {
  return tool.execute("call-1", args, new AbortController().signal, undefined, {
    cwd: "/workspace",
  });
}

describe("SF SOQL API-aware preflight", () => {
  it("uses Tooling metadata for an explicit Tooling describe", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "schema.describe",
      target_org: "ExampleOrg",
      object: "ToolOnly",
      api: "tooling",
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.request).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/tooling/sobjects/ToolOnly/describe" }),
    );
  });

  it("auto-selects Tooling for a Tooling-only object", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, ToolingField FROM ToolOnly",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(result.details.digest.query.api).toBe("tooling");
    expect(session.query).toHaveBeenCalledWith(expect.objectContaining({ api: "tooling" }));
  });

  it("uses field evidence to choose between overlapping API surfaces", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, ToolingField FROM BothObject",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(result.details.digest.query.api).toBe("tooling");
    expect(result.details.digest.api_resolution.reason).toContain("fields validate only");
    expect(session.query).toHaveBeenCalledWith(expect.objectContaining({ api: "tooling" }));
  });

  it("validates multi-level parent relationship paths recursively", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, Account.Owner.Name FROM Contact LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("validates relationship paths selected inside child subqueries", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, (SELECT Id, Owner.Name FROM Contacts LIMIT 2) FROM Account LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks invalid child-subquery filters before execution", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id, (SELECT Id FROM Contacts WHERE MissingField = true LIMIT 2) FROM Account LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("MissingField does not exist on Contact");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("blocks unsortable child-subquery fields before execution", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id, (SELECT Id, BuyerAttributes FROM Contacts ORDER BY BuyerAttributes LIMIT 2) FROM Account LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("BuyerAttributes is not sortable on Contact");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("validates semi-join clauses against the inner object", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE Email != null) LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks invalid semi-join fields on the inner object", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE MissingField = true) LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("MissingField does not exist on Contact");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("validates TYPEOF branch fields against the branch object", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, TYPEOF What WHEN Account THEN Name END FROM Task LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks invalid TYPEOF branch fields before execution", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, TYPEOF What WHEN Account THEN MissingField END FROM Task LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("MissingField does not exist on Account");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("validates TYPEOF ELSE fields against the Name contract", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id, TYPEOF What WHEN Account THEN Industry ELSE Name, Email END FROM Task LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks functions combined with TYPEOF in SELECT", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, TYPEOF What WHEN Account THEN FORMAT(CreatedDate) END FROM Task LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain(
      "TYPEOF cannot be combined with functions in the SELECT clause",
    );
    expect(session.query).not.toHaveBeenCalled();
  });

  it("blocks invalid TYPEOF ELSE fields before execution", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id, TYPEOF What WHEN Account THEN Industry ELSE MissingField END FROM Task LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("MissingField does not exist on Name");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("validates direct polymorphic traversal against the Name contract", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, What.Name FROM Task LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks direct polymorphic fields outside the Name contract", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, What.Industry FROM Task LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("What.Industry does not resolve on Name");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("validates fields nested inside date functions", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT CALENDAR_YEAR(CreatedDate) yearValue, COUNT(Id) total FROM Account WHERE CALENDAR_YEAR(CreatedDate) = 2026 GROUP BY CALENDAR_YEAR(CreatedDate) LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks missing fields nested inside date functions", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id FROM Account WHERE CALENDAR_YEAR(MissingDate__c) = 2026 LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("MissingDate__c does not exist on Account");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("blocks date functions applied to non-date fields", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id FROM Account WHERE CALENDAR_YEAR(Name) = 2026 LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("CALENDAR_YEAR requires a date or datetime field");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("validates DISTANCE against geolocation fields", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id FROM Account WHERE DISTANCE(Location__c, GEOLOCATION(37.0, -122.0), 'mi') < 10 LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks DISTANCE on non-geolocation fields", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id FROM Account WHERE DISTANCE(Name, GEOLOCATION(37.0, -122.0), 'mi') < 10 LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("DISTANCE requires a geolocation field");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("blocks invalid fields before calling the query endpoint", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, MissingField FROM Account",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.details.digest.validation.verdict).toBe("invalid");
    expect(result.content[0].text).toContain("MissingField does not exist on Account");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("blocks queryAll for a Tooling-only object", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.queryAll",
      target_org: "ExampleOrg",
      api: "tooling",
      query: "SELECT Id, ToolingField FROM ToolOnly",
      max_rows: 1,
      include_deleted: true,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain(
      "queryAll and ALL ROWS are available only through regular REST",
    );
    expect(session.query).not.toHaveBeenCalled();
  });

  it("keeps an explicit wrong API strict and does not silently retry", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      api: "rest",
      query: "SELECT Id, ToolingField FROM ToolOnly",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("REST");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("accepts a top-level object alias and validates canonical field paths", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT a.Id, a.Owner.Name FROM Account a LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("accepts chained multi-object aliases and validates their relationship paths", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT c.Id, a.Name, o.Name FROM Contact c, c.Account a, a.Owner o WHERE a.Name != null AND o.Name != null LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledTimes(1);
  });

  it("blocks API bind variables before the query endpoint", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id FROM Account WHERE Name = :name LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("Bind Variables");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("validates both FORMULA fields against their owning schema", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const valid = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id FROM Opportunity WHERE FORMULA('Amount - ExpectedRevenue') > 100 LIMIT 1",
      max_rows: 1,
    });
    expect(valid.details.digest.status).toBe("pass");

    const invalid = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id FROM Opportunity WHERE FORMULA('CloseDate - CreatedDate') > 10 LIMIT 1",
      max_rows: 1,
    });
    expect(invalid.details.digest.status).toBe("fail");
    expect(invalid.content[0].text).toContain("cannot mix date and datetime");
  });

  it("enforces bounded FIELDS(ALL) and FIELDS(CUSTOM) queries", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const unbounded = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT FIELDS(ALL) FROM Account",
    });
    expect(unbounded.details.digest.status).toBe("fail");
    expect(unbounded.content[0].text).toContain("FIELDS(ALL) requires LIMIT 200 or less");

    const bounded = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT FIELDS(ALL) FROM Account LIMIT 200",
    });
    expect(bounded.details.digest.status).toBe("pass");

    const emptyCustom = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT FIELDS(CUSTOM) FROM User LIMIT 200",
    });
    expect(emptyCustom.details.digest.status).toBe("fail");
    expect(emptyCustom.content[0].text).toContain("User has no custom fields");
  });

  it("validates FIELDS bounds recursively in child subqueries", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const unbounded = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT Id, (SELECT FIELDS(ALL) FROM Contacts) FROM Account LIMIT 1",
    });
    expect(unbounded.details.digest.status).toBe("fail");
    expect(unbounded.content[0].text).toContain("Contacts FIELDS Limit");

    const bounded = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT Id, (SELECT FIELDS(ALL) FROM Contacts LIMIT 200) FROM Account LIMIT 1",
    });
    expect(bounded.details.digest.status).toBe("pass");
  });

  it("accepts a documented Id bound for an unbounded FIELDS expansion", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT FIELDS(ALL) FROM Account WHERE Id IN ('001000000000001AAA')",
    });

    expect(
      result.details.digest.validation.findings.some(
        (finding: { label: string }) => finding.label === "FIELDS Limit",
      ),
    ).toBe(false);
  });

  it("blocks guaranteed duplicate and aggregate FIELDS expansions", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const duplicate = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT Id, FIELDS(ALL) FROM Account LIMIT 200",
    });
    expect(duplicate.details.digest.status).toBe("fail");
    expect(duplicate.content[0].text).toContain("duplicates explicitly selected fields");

    const aggregate = await execute(tool, {
      action: "query.validate",
      target_org: "ExampleOrg",
      query: "SELECT FIELDS(STANDARD), COUNT(Id) FROM Account GROUP BY Id LIMIT 200",
    });
    expect(aggregate.details.digest.status).toBe("fail");
    expect(aggregate.content[0].text).toContain("cannot be combined with aggregate or grouping");
  });

  it("blocks ContentDocumentLink without an implementation filter before execution", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, ContentDocumentId FROM ContentDocumentLink LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("ContentDocumentLink requires a WHERE filter");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("accepts documented ContentDocumentLink and Vote implementation filters", async () => {
    const contentSession = fakeSession();
    const contentTool = await registeredTool(contentSession);
    const contentResult = await execute(contentTool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query:
        "SELECT Id, ContentDocumentId FROM ContentDocumentLink WHERE ContentDocumentId = '069000000000001AAA' LIMIT 1",
      max_rows: 1,
    });
    expect(contentResult.details.digest.status).toBe("pass");
    expect(contentSession.query).toHaveBeenCalledTimes(1);

    const voteSession = fakeSession();
    const voteTool = await registeredTool(voteSession);
    const voteResult = await execute(voteTool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, ParentId FROM Vote WHERE Id = '0D7000000000001AAA' LIMIT 1",
      max_rows: 1,
    });
    expect(voteResult.details.digest.status).toBe("pass");
    expect(voteSession.query).toHaveBeenCalledTimes(1);
  });

  it("blocks Vote without an implementation filter before execution", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT Id, ParentId FROM Vote LIMIT 1",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.content[0].text).toContain("Vote requires a WHERE filter");
    expect(session.query).not.toHaveBeenCalled();
  });

  it("does not inject LIMIT into scalar aggregate samples", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.sample",
      target_org: "ExampleOrg",
      query: "SELECT MAX(CreatedDate) FROM Account",
      max_rows: 1,
    });

    expect(result.details.digest.status).toBe("pass");
    expect(session.query).toHaveBeenCalledWith(
      expect.objectContaining({ soql: "SELECT MAX(CreatedDate) FROM Account" }),
    );
  });

  it("blocks documented query semantic failures before execution", async () => {
    for (const query of [
      "SELECT MAX(CreatedDate) FROM Account LIMIT 1",
      "SELECT convertTimezone(CreatedDate) FROM Opportunity LIMIT 1",
      "SELECT CreatedDate, Amount FROM Opportunity WHERE CALENDAR_YEAR(CreatedDate) = THIS_YEAR LIMIT 1",
      "SELECT CALENDAR_YEAR(CreatedDate), Amount FROM Opportunity LIMIT 1",
    ]) {
      const session = fakeSession();
      const tool = await registeredTool(session);
      const result = await execute(tool, {
        action: "query.sample",
        target_org: "ExampleOrg",
        query,
        max_rows: 1,
      });
      expect(result.details.digest.status).toBe("fail");
      expect(session.query).not.toHaveBeenCalled();
    }
  });

  it("does not label a syntactically invalid draft as safe", async () => {
    const session = fakeSession();
    const tool = await registeredTool(session);

    const result = await execute(tool, {
      action: "query.draft",
      target_org: "ExampleOrg",
      object: "Account",
      fields: ["Id", "Name"],
      filters: ["Name ="],
      max_rows: 5,
    });

    expect(result.details.digest.status).toBe("fail");
    expect(result.details.digest.validation.verdict).toBe("invalid");
    expect(result.content[0].text).toContain("Syntax");
  });
});
