/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { SF_MCP_HEADLESS_360_REQUIREMENT } from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import {
  applyMcpServerActivation,
  buildHeadlessMcpSources,
  inspectEca,
  inspectMcpServerActivation,
} from "../lib/metadata.ts";

function source(type: string): string {
  const item = buildHeadlessMcpSources({
    appName: "SfPiHeadless360Mcp",
    appLabel: "SF Pi Headless 360 MCP",
    contactEmail: "admin@example.invalid",
  }).find((candidate) => candidate.type === type);
  if (!item) throw new Error(`Missing ${type}`);
  return item.source;
}

describe("Headless 360 External Client App metadata", () => {
  it("builds the exact four-component public PKCE stack", () => {
    const components = buildHeadlessMcpSources({
      appName: "SfPiHeadless360Mcp",
      appLabel: "SF Pi Headless 360 MCP",
      contactEmail: "admin@example.invalid",
    });

    expect(components.map((component) => component.type)).toEqual([
      "ExternalClientApplication",
      "ExtlClntAppGlobalOauthSettings",
      "ExtlClntAppOauthSettings",
      "ExtlClntAppOauthConfigurablePolicies",
    ]);
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      `<callbackUrl>${SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl}</callbackUrl>`,
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isNamedUserJwtEnabled>true</isNamedUserJwtEnabled>",
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isPkceRequired>true</isPkceRequired>",
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isConsumerSecretOptional>true</isConsumerSecretOptional>",
    );
    expect(source("ExtlClntAppGlobalOauthSettings")).toContain(
      "<isRefreshTokenRotationEnabled>true</isRefreshTokenRotationEnabled>",
    );
    expect(source("ExtlClntAppOauthSettings")).toContain(
      "<commaSeparatedOauthScopes>MCP, RefreshToken</commaSeparatedOauthScopes>",
    );
    expect(source("ExtlClntAppOauthConfigurablePolicies")).toContain(
      "<permittedUsersPolicyType>AllSelfAuthorized</permittedUsersPolicyType>",
    );
  });

  it("escapes human-provided XML values", () => {
    const components = buildHeadlessMcpSources({
      appName: "SafeName",
      appLabel: "A & B <MCP>",
      contactEmail: "admin+oauth@example.invalid",
    });

    expect(components[0]?.source).toContain("<label>A &amp; B &lt;MCP&gt;</label>");
    expect(components[0]?.source).not.toContain("<label>A & B <MCP></label>");
  });

  it("creates and verifies Headless 360 activation through the Tooling object", async () => {
    let active = false;
    const create = vi.fn(async () => {
      active = true;
      return { success: true, id: "example-mcp-access-id" };
    });
    const query = vi.fn(async () => ({
      totalSize: active ? 1 : 0,
      records: active
        ? [
            {
              Id: "example-mcp-access-id",
              DeveloperName: "platform_headless_360",
              MasterLabel: "headless-360",
              Active: true,
            },
          ]
        : [],
      done: true,
      truncated: false,
    }));
    const session = {
      target: { orgType: "developer", apiVersion: "68.0" },
      connection: {
        tooling: {
          sobject: () => ({
            describe: vi.fn(async () => ({
              createable: true,
              updateable: true,
              fields: [{ name: "DeveloperName" }, { name: "MasterLabel" }, { name: "Active" }],
            })),
            create,
            update: vi.fn(),
          }),
        },
      },
      query,
    } as unknown as SalesforceSession;

    const before = await inspectMcpServerActivation(session, "platform_headless_360");
    expect(before).toMatchObject({ supported: true, createable: true });
    expect(before.record).toBeUndefined();

    const result = await applyMcpServerActivation({
      session,
      plan: {
        developer_name: "platform_headless_360",
        master_label: "headless-360",
        operation: "create",
      },
    });

    expect(create).toHaveBeenCalledWith({
      DeveloperName: "platform_headless_360",
      MasterLabel: "headless-360",
      Active: true,
    });
    expect(result).toMatchObject({ operation: "create", active: true });
  });

  it("updates only Active when a hosted MCP activation record already exists", async () => {
    let active = false;
    const update = vi.fn(async () => {
      active = true;
      return { success: true, id: "example-mcp-access-id" };
    });
    const query = vi.fn(async () => ({
      totalSize: 1,
      records: [
        {
          Id: "example-mcp-access-id",
          DeveloperName: "platform_headless_360",
          MasterLabel: "headless-360",
          Active: active,
        },
      ],
      done: true,
      truncated: false,
    }));
    const session = {
      target: { orgType: "developer", apiVersion: "68.0" },
      connection: {
        tooling: {
          sobject: () => ({
            describe: vi.fn(async () => ({
              createable: true,
              updateable: true,
              fields: [{ name: "DeveloperName" }, { name: "MasterLabel" }, { name: "Active" }],
            })),
            create: vi.fn(),
            update,
          }),
        },
      },
      query,
    } as unknown as SalesforceSession;

    const result = await applyMcpServerActivation({
      session,
      plan: {
        developer_name: "platform_headless_360",
        master_label: "headless-360",
        operation: "update",
        before: {
          id: "example-mcp-access-id",
          developer_name: "platform_headless_360",
          master_label: "headless-360",
          active: false,
        },
      },
    });

    expect(update).toHaveBeenCalledWith({ Id: "example-mcp-access-id", Active: true });
    expect(result).toMatchObject({ operation: "update", active: true });
  });

  it("resolves the Tooling API record id used by the exact Setup detail link", async () => {
    const appName = "SfPiHeadless360Mcp";
    const read = vi.fn(async (type: string) => {
      const values: Record<string, Record<string, unknown>> = {
        ExternalClientApplication: { fullName: appName },
        ExtlClntAppGlobalOauthSettings: {
          fullName: appName,
          consumerKey: "public-client-id",
          callbackUrl: "http://localhost:8765/callback",
          isPkceRequired: true,
          isConsumerSecretOptional: true,
          isNamedUserJwtEnabled: true,
          isRefreshTokenRotationEnabled: true,
        },
        ExtlClntAppOauthSettings: {
          fullName: appName,
          commaSeparatedOauthScopes: "MCP, RefreshToken",
        },
        ExtlClntAppOauthConfigurablePolicies: { fullName: appName },
      };
      return values[type];
    });
    const query = vi.fn(async () => ({
      totalSize: 1,
      records: [{ Id: "0xI000000000001AAA" }],
      done: true,
      truncated: false,
    }));
    const session = {
      target: { apiVersion: "68.0" },
      connection: { metadata: { read } },
      query,
    } as unknown as SalesforceSession;

    const inspection = await inspectEca(session, appName);

    expect(inspection.record_id).toBe("0xI000000000001AAA");
    expect(query).toHaveBeenCalledWith({
      soql: "SELECT Id FROM ExternalClientApplication WHERE DeveloperName = 'SfPiHeadless360Mcp' LIMIT 2",
      api: "tooling",
      maxRows: 2,
    });
  });
});
