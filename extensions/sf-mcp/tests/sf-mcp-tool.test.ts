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

function registeredTool() {
  const registerTool = vi.fn();
  registerSfMcpTool({ registerTool } as unknown as ExtensionAPI);
  expect(registerTool).toHaveBeenCalledTimes(1);
  return registerTool.mock.calls[0]![0];
}

function context(cwd: string, trusted = true) {
  return {
    cwd,
    isProjectTrusted: () => trusted,
  } as never;
}

async function execute(
  tool: ReturnType<typeof registeredTool>,
  cwd: string,
  params: Record<string, unknown>,
  trusted = true,
) {
  return tool.execute("call-1", params, undefined, undefined, context(cwd, trusted));
}

describe("sf_mcp tool", () => {
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
