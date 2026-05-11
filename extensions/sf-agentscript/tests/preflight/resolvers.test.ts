/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver-by-resolver tests.
 *
 * Each resolver is exercised against a fake Connection so the test runs
 * offline. The fake captures the request URL so we can assert each
 * resolver hits the right SOQL endpoint with the right sObject + name
 * field.
 */

import { describe, expect, it, vi } from "vitest";
import type { Connection } from "@salesforce/core";

import { agentforceResolver } from "../../lib/preflight/resolvers/agentforce.ts";
import { alwaysAvailableResolver } from "../../lib/preflight/resolvers/always-available.ts";
import { apexResolver } from "../../lib/preflight/resolvers/apex.ts";
import { externalServiceResolver } from "../../lib/preflight/resolvers/external-service.ts";
import { flowResolver } from "../../lib/preflight/resolvers/flow.ts";
import { placeholderResolver } from "../../lib/preflight/resolvers/placeholder.ts";
import { promptTemplateResolver } from "../../lib/preflight/resolvers/prompt-template.ts";
import { quickActionResolver } from "../../lib/preflight/resolvers/quick-action.ts";

interface CapturedRequest {
  url?: string;
}

function fakeConn(rows: Array<Record<string, string>>) {
  const captured: CapturedRequest = {};
  const request = vi.fn(async (options: { url: string }) => {
    captured.url = options.url;
    return { records: rows };
  });
  return { conn: { request } as unknown as Connection, captured };
}

function decode(url: string | undefined): string {
  return url ? decodeURIComponent(url) : "";
}

describe("flowResolver", () => {
  it("hits /query?FlowDefinitionView.ApiName and dedups names", async () => {
    const { conn, captured } = fakeConn([{ ApiName: "MyFlow" }]);
    const found = await flowResolver.resolve(conn, ["MyFlow", "MyFlow", "Other"]);
    expect(found?.has("MyFlow")).toBe(true);
    expect(decode(captured.url)).toContain("/query");
    expect(decode(captured.url)).toContain("FROM FlowDefinitionView");
    expect(decode(captured.url)).toContain("ApiName");
    // Dedup
    const matches = (decode(captured.url).match(/'MyFlow'/g) ?? []).length;
    expect(matches).toBe(1);
  });

  it("returns empty Set for empty input without a network call", async () => {
    const { conn } = fakeConn([]);
    const found = await flowResolver.resolve(conn, []);
    expect(found?.size).toBe(0);
    expect(
      (conn as unknown as { request: { mock: { calls: unknown[] } } }).request.mock.calls,
    ).toHaveLength(0);
  });

  it("fixHint suggests deploying the Flow", () => {
    expect(flowResolver.fixHint?.("MyFlow")).toMatch(/Flow:MyFlow/);
  });
});

describe("apexResolver", () => {
  it("handles both apex:// and apexRest:// schemes against ApexClass.Name (Tooling)", async () => {
    expect(apexResolver.schemes).toContain("apex");
    expect(apexResolver.schemes).toContain("apexRest");
    const { conn, captured } = fakeConn([{ Name: "MyClass" }]);
    const found = await apexResolver.resolve(conn, ["MyClass"]);
    expect(found?.has("MyClass")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM ApexClass");
  });

  it("fixHint suggests deploying the ApexClass", () => {
    expect(apexResolver.fixHint?.("MyClass")).toMatch(/ApexClass:MyClass/);
  });
});

describe("agentforceResolver", () => {
  it("queries BotDefinition.DeveloperName via data API", async () => {
    const { conn, captured } = fakeConn([{ DeveloperName: "Order_Agent" }]);
    const found = await agentforceResolver.resolve(conn, ["Order_Agent"]);
    expect(found?.has("Order_Agent")).toBe(true);
    expect(decode(captured.url)).toContain("/query");
    expect(decode(captured.url)).toContain("FROM BotDefinition");
    expect(decode(captured.url)).toContain("DeveloperName");
  });
});

describe("externalServiceResolver", () => {
  it("queries ExternalServiceRegistration.DeveloperName via Tooling API", async () => {
    const { conn, captured } = fakeConn([{ DeveloperName: "MyService" }]);
    const found = await externalServiceResolver.resolve(conn, ["MyService"]);
    expect(found?.has("MyService")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM ExternalServiceRegistration");
  });
});

describe("promptTemplateResolver", () => {
  it("queries Prompt.DeveloperName via Tooling API (for generatePromptResponse://)", async () => {
    expect(promptTemplateResolver.schemes).toEqual(["generatePromptResponse"]);
    const { conn, captured } = fakeConn([{ DeveloperName: "Generate_Schedule" }]);
    const found = await promptTemplateResolver.resolve(conn, ["Generate_Schedule"]);
    expect(found?.has("Generate_Schedule")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM Prompt");
  });
});

describe("quickActionResolver", () => {
  it("queries QuickActionDefinition.DeveloperName via Tooling API", async () => {
    const { conn, captured } = fakeConn([{ DeveloperName: "LogACall" }]);
    const found = await quickActionResolver.resolve(conn, ["LogACall"]);
    expect(found?.has("LogACall")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM QuickActionDefinition");
  });
});

describe("alwaysAvailableResolver", () => {
  it("returns Set(allNames) without a network call for all its schemes", async () => {
    const expected = [
      "standardInvocableAction",
      "http",
      "https",
      "mcp",
      "mcpTool",
      "slack",
      "byon",
    ];
    expect(new Set(alwaysAvailableResolver.schemes)).toEqual(new Set(expected));
    const { conn } = fakeConn([]);
    const found = await alwaysAvailableResolver.resolve(conn, ["A", "B", "C"]);
    expect(found?.size).toBe(3);
    expect(found?.has("A")).toBe(true);
    expect(found?.has("B")).toBe(true);
    expect(found?.has("C")).toBe(true);
    expect(
      (conn as unknown as { request: { mock: { calls: unknown[] } } }).request.mock.calls,
    ).toHaveLength(0);
  });
});

describe("placeholderResolver", () => {
  it("returns an empty Set so every placeholder counts as missing", async () => {
    const found = await placeholderResolver.resolve(undefined as unknown as Connection, ["X"]);
    expect(found?.size).toBe(0);
    expect(placeholderResolver.fixHint?.("X")).toMatch(/Replace placeholder/);
  });
});
