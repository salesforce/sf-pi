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
});
