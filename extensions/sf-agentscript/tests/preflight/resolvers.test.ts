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
    expect(decode(captured.url)).toContain("IsActive = true");
    expect(decode(captured.url)).not.toContain("ProcessType = 'AutoLaunchedFlow'");
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
    const { conn, captured } = fakeConn([
      {
        Name: "MyClass",
        Body: "public class MyClass { @InvocableMethod public static void run() {} }",
      },
    ]);
    const found = await apexResolver.resolve(
      conn,
      ["MyClass"],
      [{ name: "x", target: "apex://MyClass", scheme: "apex", ref_name: "MyClass" }],
    );
    expect(found?.has("MyClass")).toBe(true);
    expect(decode(captured.url)).toContain("/tooling/query");
    expect(decode(captured.url)).toContain("FROM ApexClass");
    expect(decode(captured.url)).toContain("Body");
  });

  it("requires @InvocableMethod for apex:// targets", async () => {
    const { conn } = fakeConn([{ Name: "PlainClass", Body: "public class PlainClass {}" }]);
    const found = await apexResolver.resolve(
      conn,
      ["PlainClass"],
      [{ name: "x", target: "apex://PlainClass", scheme: "apex", ref_name: "PlainClass" }],
    );
    expect(found?.has("PlainClass")).toBe(false);
    const detailed = await apexResolver.resolveTargets?.(conn, [
      { name: "x", target: "apex://PlainClass", scheme: "apex", ref_name: "PlainClass" },
    ]);
    expect(detailed?.[0].reason).toBe("missing_invocable_method");
    expect(detailed?.[0].detail).toMatch(/does not contain @InvocableMethod/);
  });

  it("checks Agent Script I/O names against @InvocableVariable fields", async () => {
    const { conn } = fakeConn([
      {
        Name: "OrderAction",
        Body: [
          "public class OrderAction {",
          "  public class Request { @InvocableVariable public String orderId; }",
          "  public class Response { @InvocableVariable public String status; }",
          "  @InvocableMethod public static List<Response> run(List<Request> reqs) { return null; }",
          "}",
        ].join("\n"),
      },
    ]);
    const found = await apexResolver.resolve(
      conn,
      ["OrderAction"],
      [
        {
          name: "ok",
          target: "apex://OrderAction",
          scheme: "apex",
          ref_name: "OrderAction",
          input_names: ["orderId"],
          output_names: ["status"],
        },
      ],
    );
    expect(found?.has("OrderAction")).toBe(true);

    const mismatch = await apexResolver.resolve(
      conn,
      ["OrderAction"],
      [
        {
          name: "bad",
          target: "apex://OrderAction",
          scheme: "apex",
          ref_name: "OrderAction",
          input_names: ["order_id"],
          output_names: ["status"],
        },
      ],
    );
    expect(mismatch?.has("OrderAction")).toBe(false);
    const detailed = await apexResolver.resolveTargets?.(conn, [
      {
        name: "bad",
        target: "apex://OrderAction",
        scheme: "apex",
        ref_name: "OrderAction",
        input_names: ["order_id"],
        output_names: ["status"],
      },
    ]);
    expect(detailed?.[0].reason).toBe("io_mismatch");
    expect(detailed?.[0].detail).toMatch(/order_id/);
    expect(detailed?.[0].detail).toMatch(/orderId/);
  });

  it("requires @RestResource for apexRest:// targets", async () => {
    const { conn } = fakeConn([
      { Name: "RestClass", Body: "@RestResource public class RestClass {}" },
    ]);
    const found = await apexResolver.resolve(
      conn,
      ["RestClass"],
      [{ name: "x", target: "apexRest://RestClass", scheme: "apexRest", ref_name: "RestClass" }],
    );
    expect(found?.has("RestClass")).toBe(true);

    const { conn: badConn } = fakeConn([{ Name: "RestClass", Body: "public class RestClass {}" }]);
    const detailed = await apexResolver.resolveTargets?.(badConn, [
      { name: "x", target: "apexRest://RestClass", scheme: "apexRest", ref_name: "RestClass" },
    ]);
    expect(detailed?.[0].reason).toBe("missing_rest_resource");
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
    expect(decode(captured.url)).toContain("Status = 'Active'");
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
