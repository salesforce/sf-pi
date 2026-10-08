/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mcpConfigPath, upsertMcpServer } from "../lib/mcp-config.ts";
import { registerSfMcpTool } from "../lib/sf-mcp-tool.ts";

const tempDirs: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-mcp-tool-"));
  tempDirs.push(cwd);
  process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");
  return cwd;
}

function registeredTool(dependencies?: Parameters<typeof registerSfMcpTool>[1]) {
  const registerTool = vi.fn();
  registerSfMcpTool({ registerTool } as unknown as ExtensionAPI, dependencies);
  expect(registerTool).toHaveBeenCalledTimes(1);
  return registerTool.mock.calls[0]![0];
}

function context(
  cwd: string,
  trusted = true,
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown> = vi.fn(),
) {
  return {
    cwd,
    isProjectTrusted: () => trusted,
    executeTool,
  } as never;
}

async function execute(
  tool: ReturnType<typeof registeredTool>,
  cwd: string,
  params: Record<string, unknown>,
  trusted = true,
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>,
) {
  return tool.execute("call-1", params, undefined, undefined, context(cwd, trusted, executeTool));
}

describe("sf_mcp tool", () => {
  it("configures independent Headless 360 connection instances for two target orgs", async () => {
    const cwd = workspace();
    const resolveHostedOrgBinding = vi.fn(async ({ targetOrg }: { targetOrg: string }) => ({
      targetOrg,
      alias: targetOrg,
      orgId: targetOrg === "OrgA" ? "example-org-a" : "example-org-b",
      orgType: "developer" as const,
      hostKey: `${targetOrg.toLowerCase()}.develop`,
      serverUrl: `https://api.salesforce.com/platform/mcp/v1/d/${targetOrg.toLowerCase()}.develop/platform/headless-360`,
      authorizationIssuer: `https://${targetOrg.toLowerCase()}.develop.my.salesforce.com`,
    }));
    const tool = registeredTool({ resolveHostedOrgBinding });

    for (const targetOrg of ["OrgA", "OrgB"]) {
      const planned = await execute(tool, cwd, {
        action: "connection.plan",
        scope: "global",
        preset_id: "headless-360",
        target_org: targetOrg,
        oauth_client_id: `public-client-${targetOrg}`,
      });
      expect(planned).toMatchObject({
        details: {
          ok: true,
          action: "connection.plan",
          connectionName: `salesforce-headless-360-${targetOrg.toLowerCase()}`,
          targetOrg,
        },
      });

      const applied = await execute(tool, cwd, {
        action: "connection.apply",
        scope: "global",
        preset_id: "headless-360",
        connection_name: planned.details.connectionName,
        plan_id: planned.details.planId,
        plan_hash: planned.details.planHash,
        allow_mutation: true,
      });
      expect(applied).toMatchObject({
        details: {
          ok: true,
          action: "connection.apply",
          connectionName: planned.details.connectionName,
          verified: true,
        },
      });
    }

    const config = JSON.parse(readFileSync(mcpConfigPath(cwd, "global"), "utf8"));
    expect(Object.keys(config.mcpServers).sort()).toEqual([
      "salesforce-headless-360-orga",
      "salesforce-headless-360-orgb",
    ]);
    expect(config.mcpServers["salesforce-headless-360-orga"].url).toContain("/d/orga.develop/");
    expect(config.mcpServers["salesforce-headless-360-orgb"].url).toContain("/d/orgb.develop/");

    const status = await execute(tool, cwd, {
      action: "status",
      scope: "global",
      preset_id: "headless-360",
    });
    expect(status.details.presets[0].connections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          serverName: "salesforce-headless-360-orga",
          targetOrg: "OrgA",
        }),
        expect.objectContaining({
          serverName: "salesforce-headless-360-orgb",
          targetOrg: "OrgB",
        }),
      ]),
    );

    const ambiguousLogin = await execute(tool, cwd, {
      action: "login.handoff",
      scope: "global",
      preset_id: "headless-360",
    });
    expect(ambiguousLogin).toMatchObject({ isError: true, details: { ok: false } });
    expect(ambiguousLogin.content[0]?.text).toMatch(/connection_name/i);

    const login = await execute(tool, cwd, {
      action: "login.handoff",
      scope: "global",
      preset_id: "headless-360",
      connection_name: "salesforce-headless-360-orga",
    });
    expect(login).toMatchObject({
      details: {
        ok: true,
        serverName: "salesforce-headless-360-orga",
        command: "/mcp login salesforce-headless-360-orga",
      },
    });
  });

  it("disambiguates org aliases that collide after Pi normalizes server names", async () => {
    const cwd = workspace();
    const resolveHostedOrgBinding = vi.fn(async ({ targetOrg }: { targetOrg: string }) => {
      const hostKey = `${targetOrg.toLowerCase().replaceAll("_", "-")}.develop`;
      return {
        targetOrg,
        alias: targetOrg,
        orgId: targetOrg === "Demo-A" ? "example-org-a" : "example-org-b",
        orgType: "developer" as const,
        hostKey,
        serverUrl: `https://api.salesforce.com/platform/mcp/v1/d/${hostKey}/platform/headless-360`,
        authorizationIssuer: `https://${hostKey}.my.salesforce.com`,
      };
    });
    const tool = registeredTool({ resolveHostedOrgBinding });
    const names: string[] = [];

    for (const targetOrg of ["Demo-A", "Demo_A"]) {
      const planned = await execute(tool, cwd, {
        action: "connection.plan",
        scope: "global",
        preset_id: "headless-360",
        target_org: targetOrg,
        oauth_client_id: `client-${targetOrg}`,
      });
      names.push(String(planned.details.connectionName));
      const applied = await execute(tool, cwd, {
        action: "connection.apply",
        scope: "global",
        preset_id: "headless-360",
        connection_name: planned.details.connectionName,
        plan_id: planned.details.planId,
        plan_hash: planned.details.planHash,
        allow_mutation: true,
      });
      expect(applied.isError).not.toBe(true);
    }

    expect(names[0]).toBe("salesforce-headless-360-demo-a");
    expect(names[1]).toMatch(/^salesforce-headless-360-demo_a-[a-f0-9]{8}$/u);
    const config = JSON.parse(readFileSync(mcpConfigPath(cwd, "global"), "utf8"));
    expect(Object.keys(config.mcpServers)).toHaveLength(2);
  });

  it("verifies a logged-in Headless 360 instance against its planned org identity", async () => {
    const cwd = workspace();
    const binding = {
      targetOrg: "OrgA",
      alias: "OrgA",
      orgId: "example-org-a",
      orgType: "developer" as const,
      hostKey: "orga.develop",
      serverUrl: "https://api.salesforce.com/platform/mcp/v1/d/orga.develop/platform/headless-360",
      authorizationIssuer: "https://orga.develop.my.salesforce.com",
    };
    const tool = registeredTool({ resolveHostedOrgBinding: vi.fn(async () => binding) });
    const connection = await execute(tool, cwd, {
      action: "connection.plan",
      scope: "global",
      preset_id: "headless-360",
      target_org: "OrgA",
      oauth_client_id: "public-client",
    });
    await execute(tool, cwd, {
      action: "connection.apply",
      scope: "global",
      preset_id: "headless-360",
      connection_name: connection.details.connectionName,
      plan_id: connection.details.planId,
      plan_hash: connection.details.planHash,
      allow_mutation: true,
    });
    const tools = await execute(tool, cwd, {
      action: "tools.plan",
      scope: "global",
      preset_id: "headless-360",
      connection_name: connection.details.connectionName,
      tool_profile: "recommended",
    });
    await execute(tool, cwd, {
      action: "tools.apply",
      scope: "global",
      preset_id: "headless-360",
      connection_name: connection.details.connectionName,
      plan_id: tools.details.planId,
      plan_hash: tools.details.planHash,
      allow_mutation: true,
    });
    const executeTool = vi.fn(async () => ({
      content: [{ type: "text", text: JSON.stringify({ organization_id: binding.orgId }) }],
    }));

    const verified = await execute(
      tool,
      cwd,
      {
        action: "identity.verify",
        scope: "global",
        preset_id: "headless-360",
        connection_name: connection.details.connectionName,
      },
      true,
      executeTool,
    );

    expect(verified).toMatchObject({
      details: {
        ok: true,
        action: "identity.verify",
        connectionName: "salesforce-headless-360-orga",
        verified: true,
      },
    });
    expect(executeTool).toHaveBeenCalledWith(
      "mcp__salesforce_headless_360_orga__dispatch_readonly",
      expect.objectContaining({
        url: "https://orga.develop.my.salesforce.com/services/oauth2/userinfo",
        method: "GET",
      }),
      { signal: undefined },
    );
  });

  it("refuses an org-bound plan when OAuth discovery changes before apply", async () => {
    const cwd = workspace();
    let calls = 0;
    const resolveHostedOrgBinding = vi.fn(async () => {
      calls += 1;
      return {
        targetOrg: "OrgA",
        alias: "OrgA",
        orgId: "example-org-a",
        orgType: "developer" as const,
        hostKey: "orga.develop",
        serverUrl:
          calls === 1
            ? "https://api.salesforce.com/platform/mcp/v1/d/orga.develop/platform/headless-360"
            : "https://api.salesforce.com/platform/mcp/v1/d/other.develop/platform/headless-360",
        authorizationIssuer:
          calls === 1
            ? "https://orga.develop.my.salesforce.com"
            : "https://other.develop.my.salesforce.com",
      };
    });
    const tool = registeredTool({ resolveHostedOrgBinding });
    const planned = await execute(tool, cwd, {
      action: "connection.plan",
      scope: "global",
      preset_id: "headless-360",
      target_org: "OrgA",
      oauth_client_id: "public-client",
    });

    const applied = await execute(tool, cwd, {
      action: "connection.apply",
      scope: "global",
      preset_id: "headless-360",
      connection_name: planned.details.connectionName,
      plan_id: planned.details.planId,
      plan_hash: planned.details.planHash,
      allow_mutation: true,
    });

    expect(applied).toMatchObject({ isError: true, details: { ok: false } });
    expect(applied.content[0]?.text).toMatch(/changed after planning/i);
    expect(() => readFileSync(mcpConfigPath(cwd, "global"), "utf8")).toThrow();
  });

  it("plans and applies an exact reviewed preset without exposing the consumer key", async () => {
    const cwd = workspace();
    const tool = registeredTool();
    const consumerKey = "public-consumer-key";

    const planned = await execute(tool, cwd, {
      action: "configure.plan",
      scope: "global",
      preset_id: "headless-360",
      resolution: "side-by-side",
      environment: "sandbox",
      oauth_client_id: consumerKey,
      tool_profile: "recommended",
    });

    expect(planned.isError).not.toBe(true);
    expect(planned.content[0]?.text).not.toContain(consumerKey);
    expect(planned.details).toMatchObject({
      ok: true,
      action: "configure.plan",
      scope: "global",
      presetId: "headless-360",
      willChange: true,
    });
    expect(planned.details.planId).toMatch(/^plan_/);
    expect(planned.details.planHash).toMatch(/^sha256:/);
    expect(() => readFileSync(mcpConfigPath(cwd, "global"), "utf8")).toThrow();

    const refused = await execute(tool, cwd, {
      action: "configure.apply",
      scope: "global",
      preset_id: "headless-360",
      plan_id: planned.details.planId,
      plan_hash: planned.details.planHash,
      allow_mutation: false,
    });
    expect(refused).toMatchObject({ isError: true, details: { ok: false } });

    const applied = await execute(tool, cwd, {
      action: "configure.apply",
      scope: "global",
      preset_id: "headless-360",
      plan_id: planned.details.planId,
      plan_hash: planned.details.planHash,
      allow_mutation: true,
    });

    expect(applied).toMatchObject({
      details: {
        ok: true,
        action: "configure.apply",
        verified: true,
        reloadRequired: true,
      },
    });
    const config = JSON.parse(readFileSync(mcpConfigPath(cwd, "global"), "utf8"));
    expect(config.mcpServers["salesforce-headless-360"]).toMatchObject({
      url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/headless-360",
      oauth: {
        clientId: consumerKey,
        callbackUrl: "http://localhost:8765/callback",
      },
      exposure: "hidden",
      toolExposure: {
        discover: "codemode",
        describe: "codemode",
        dispatch: "hidden",
        dispatch_readonly: "deferred",
      },
    });
  });

  it("plans connection and tool access independently", async () => {
    const cwd = workspace();
    const tool = registeredTool();

    const connection = await execute(tool, cwd, {
      action: "connection.plan",
      scope: "global",
      preset_id: "headless-360",
      environment: "sandbox",
      oauth_client_id: "public-consumer-key",
    });
    expect(connection).toMatchObject({
      details: {
        ok: true,
        action: "connection.plan",
        presetId: "headless-360",
      },
    });
    const connected = await execute(tool, cwd, {
      action: "connection.apply",
      scope: "global",
      preset_id: "headless-360",
      plan_id: connection.details.planId,
      plan_hash: connection.details.planHash,
      allow_mutation: true,
    });
    expect(connected).toMatchObject({
      details: { ok: true, action: "connection.apply", verified: true },
    });
    let config = JSON.parse(readFileSync(mcpConfigPath(cwd, "global"), "utf8"));
    expect(Object.values(config.mcpServers["salesforce-headless-360"].toolExposure)).toEqual([
      "hidden",
      "hidden",
      "hidden",
      "hidden",
    ]);

    const tools = await execute(tool, cwd, {
      action: "tools.plan",
      scope: "global",
      preset_id: "headless-360",
      tool_profile: "recommended",
      tool_overrides: { dispatch_readonly: "direct" },
    });
    expect(tools).toMatchObject({
      details: {
        ok: true,
        action: "tools.plan",
        profile: "custom",
        exposures: {
          discover: "codemode",
          describe: "codemode",
          dispatch: "hidden",
          dispatch_readonly: "direct",
        },
      },
    });
    const exposed = await execute(tool, cwd, {
      action: "tools.apply",
      scope: "global",
      preset_id: "headless-360",
      plan_id: tools.details.planId,
      plan_hash: tools.details.planHash,
      allow_mutation: true,
    });
    expect(exposed).toMatchObject({
      details: { ok: true, action: "tools.apply", verified: true },
    });
    config = JSON.parse(readFileSync(mcpConfigPath(cwd, "global"), "utf8"));
    expect(config.mcpServers["salesforce-headless-360"].toolExposure).toEqual({
      discover: "codemode",
      describe: "codemode",
      dispatch: "hidden",
      dispatch_readonly: "direct",
    });
  });

  it("rejects a source-bound configure plan after the target entry changes", async () => {
    const cwd = workspace();
    const tool = registeredTool();
    const planned = await execute(tool, cwd, {
      action: "configure.plan",
      scope: "global",
      preset_id: "headless-360",
      resolution: "side-by-side",
      environment: "production",
      oauth_client_id: "public-consumer-key",
    });

    expect(
      upsertMcpServer(mcpConfigPath(cwd, "global"), "salesforce-headless-360", {
        url: "https://example.test/manually-changed",
      }).ok,
    ).toBe(true);

    const applied = await execute(tool, cwd, {
      action: "configure.apply",
      scope: "global",
      preset_id: "headless-360",
      plan_id: planned.details.planId,
      plan_hash: planned.details.planHash,
      allow_mutation: true,
    });

    expect(applied).toMatchObject({ isError: true, details: { ok: false } });
    expect(applied.content[0]?.text).toMatch(/changed after planning/i);
  });

  it("plans and applies disable before returning a human OAuth login handoff", async () => {
    const cwd = workspace();
    const tool = registeredTool();
    const configured = await execute(tool, cwd, {
      action: "configure.plan",
      scope: "global",
      preset_id: "headless-360",
      resolution: "side-by-side",
      environment: "production",
      oauth_client_id: "public-consumer-key",
    });
    await execute(tool, cwd, {
      action: "configure.apply",
      scope: "global",
      preset_id: "headless-360",
      plan_id: configured.details.planId,
      plan_hash: configured.details.planHash,
      allow_mutation: true,
    });

    const handoff = await execute(tool, cwd, {
      action: "login.handoff",
      scope: "global",
      preset_id: "headless-360",
    });
    expect(handoff).toMatchObject({
      details: {
        ok: true,
        action: "login.handoff",
        serverName: "salesforce-headless-360",
        command: "/mcp login salesforce-headless-360",
      },
    });
    expect(handoff.content[0]?.text).toContain("human OAuth consent");

    const planned = await execute(tool, cwd, {
      action: "disable.plan",
      scope: "global",
      preset_id: "headless-360",
    });
    const disabled = await execute(tool, cwd, {
      action: "disable.apply",
      scope: "global",
      preset_id: "headless-360",
      plan_id: planned.details.planId,
      plan_hash: planned.details.planHash,
      allow_mutation: true,
    });

    expect(disabled).toMatchObject({
      details: {
        ok: true,
        action: "disable.apply",
        verified: true,
        reloadRequired: true,
      },
    });
    const config = JSON.parse(readFileSync(mcpConfigPath(cwd, "global"), "utf8"));
    expect(config.mcpServers["salesforce-headless-360"].enabled).toBe(false);
  });

  it("refuses project-scope mutations when the project is untrusted", async () => {
    const cwd = workspace();
    const tool = registeredTool();

    const result = await execute(
      tool,
      cwd,
      {
        action: "configure.plan",
        scope: "project",
        preset_id: "headless-360",
        resolution: "side-by-side",
        environment: "sandbox",
        oauth_client_id: "public-consumer-key",
      },
      false,
    );

    expect(result).toMatchObject({ isError: true, details: { ok: false } });
    expect(result.content[0]?.text).toMatch(/trust/i);
  });
});
