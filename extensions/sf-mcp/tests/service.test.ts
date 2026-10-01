/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mcpConfigPath, upsertMcpServer } from "../lib/mcp-config.ts";
import { captureObservedMcpTools } from "../lib/observed-tools.ts";
import {
  adoptPreset,
  buildMcpRoutingGuidelines,
  installPreset,
  inspectPresetRuntime,
  reconcileCanonicalServerNames,
  summarizeConfigDiff,
} from "../lib/service.ts";
import { buildServerConfig, getPreset } from "../lib/presets.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-mcp-service-"));
  tempDirs.push(dir);
  return dir;
}

describe("SF MCP preset service", () => {
  it("adds compact routing guidance only for accepted side-by-side overlaps", () => {
    const cwd = workspace();
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: "sobject-reads",
        resolution: "side-by-side",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);

    expect(buildMcpRoutingGuidelines(cwd)).toEqual([
      expect.stringContaining("SObject Reads MCP is enabled side-by-side with sf-soql"),
    ]);
  });

  it("reports when a project preset would override the same global server name", () => {
    const cwd = workspace();
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");
    try {
      expect(
        upsertMcpServer(mcpConfigPath(cwd, "global"), "salesforce-dx", {
          command: "npx",
        }).ok,
      ).toBe(true);

      expect(
        inspectPresetRuntime(cwd, "project", getPreset("salesforce-dx")).scopeConflict,
      ).toMatchObject({
        kind: "project-would-override-global",
      });
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });

  it("adopts a compatible manual entry without replacing native configuration", () => {
    const cwd = workspace();
    const preset = getPreset("sobject-reads");
    const config = buildServerConfig(preset, "enable", {
      environment: "sandbox",
      oauthClientId: "consumer-key",
    });
    expect(upsertMcpServer(mcpConfigPath(cwd, "project"), preset.serverName, config).ok).toBe(true);

    const result = adoptPreset({ cwd, scope: "project", presetId: preset.id });

    expect(result).toMatchObject({ ok: true, changed: false, reloadRequired: false });
    expect(inspectPresetRuntime(cwd, "project", preset).managed.status).toBe("managed-enabled");
  });

  it("resets a reviewed manual entry to the current preset", () => {
    const cwd = workspace();
    const preset = getPreset("sobject-reads");
    expect(
      upsertMcpServer(mcpConfigPath(cwd, "project"), preset.serverName, {
        url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-reads",
        oauth: { clientId: "old-client" },
        exposure: "codemode",
      }).ok,
    ).toBe(true);

    const result = installPreset({
      cwd,
      scope: "project",
      presetId: preset.id,
      resolution: "enable",
      setup: { environment: "sandbox", oauthClientId: "new-client" },
      replaceExisting: true,
    });

    expect(result).toMatchObject({ ok: true, changed: true, reloadRequired: true });
    const written = JSON.parse(readFileSync(mcpConfigPath(cwd, "project"), "utf8"));
    expect(written.mcpServers[preset.serverName]).toMatchObject({
      exposure: "hidden",
      oauth: { clientId: "new-client" },
    });
  });

  it("redacts credential values from configuration diffs", () => {
    const diff = summarizeConfigDiff(
      {
        url: "https://example.test/old?token=secret-query-old",
        headers: { Authorization: "Bearer secret-old" },
        oauth: { clientId: "old-client", clientSecret: "old-secret" },
      },
      {
        url: "https://example.test/new?token=secret-query-new",
        headers: { Authorization: "Bearer secret-new" },
        oauth: { clientId: "new-client", clientSecret: "new-secret" },
      },
    ).join("\n");

    expect(diff).toContain("url:");
    expect(diff).not.toContain("secret");
    expect(diff).not.toContain("old-client");
    expect(diff).not.toContain("new-client");
  });

  it("requires review when observed tools drift from the approved preset contract", () => {
    const cwd = workspace();
    const preset = getPreset("sobject-reads");
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: preset.id,
        resolution: "enable",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);
    captureObservedMcpTools([
      { name: "mcp__salesforce_sobject_reads__getObjectSchema" },
      { name: "mcp__salesforce_sobject_reads__unexpectedWrite" },
    ]);

    expect(inspectPresetRuntime(cwd, "project", preset).drift).toMatchObject({
      status: "review",
      added: ["unexpectedWrite"],
    });
  });

  it("reconciles canonical duplicate names only after selecting the entry to keep", () => {
    const cwd = workspace();
    const file = mcpConfigPath(cwd, "project");
    expect(
      upsertMcpServer(file, "salesforce-sobject-reads", { url: "https://example.test/one" }).ok,
    ).toBe(true);
    const root = JSON.parse(readFileSync(file, "utf8"));
    root.mcpServers.salesforce_sobject_reads = { url: "https://example.test/two" };
    writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`);

    expect(inspectPresetRuntime(cwd, "project", getPreset("sobject-reads")).managed).toMatchObject({
      status: "name-conflict",
    });
    expect(
      reconcileCanonicalServerNames({
        cwd,
        scope: "project",
        presetId: "sobject-reads",
        keepName: "salesforce_sobject_reads",
      }),
    ).toMatchObject({ ok: true, reloadRequired: true });
  });

  it("applies the SObject All recommendation as a scoped mutation preset", () => {
    const cwd = workspace();
    const result = installPreset({
      cwd,
      scope: "project",
      presetId: "sobject-all",
      resolution: "use-sobject-mutations",
      setup: { environment: "sandbox", oauthClientId: "consumer-key" },
    });

    expect(result).toMatchObject({
      ok: true,
      preset: { id: "sobject-mutations" },
      resolution: "complement-native",
    });
    const config = JSON.parse(readFileSync(mcpConfigPath(cwd, "project"), "utf8"));
    expect(config.mcpServers).not.toHaveProperty("salesforce-sobject-all");
    expect(config.mcpServers["salesforce-sobject-mutations"]).toMatchObject({
      description: getPreset("sobject-mutations").description,
      exposure: "hidden",
      toolExposure: {
        createSobjectRecord: "codemode",
        updateSobjectRecord: "codemode",
      },
    });
    expect(
      inspectPresetRuntime(cwd, "project", getPreset("sobject-mutations")).managed.status,
    ).toBe("managed-enabled");
  });
});
