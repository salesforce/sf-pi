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
  updateManagedPresetToolPolicy,
} from "../lib/service.ts";
import { buildServerConfig, getPreset } from "../lib/presets.ts";
import { inspectPresetTools } from "../lib/tool-catalog.ts";
import { buildConflictAwareToolPolicy } from "../lib/tool-conflicts.ts";
import { buildToolExposurePolicy } from "../lib/tool-policy.ts";

const tempDirs: string[] = [];

afterEach(() => {
  captureObservedMcpTools([]);
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
        presetId: "salesforce-dx",
        resolution: "side-by-side",
      }).ok,
    ).toBe(true);

    expect(buildMcpRoutingGuidelines(cwd)).toEqual([
      expect.stringContaining("Salesforce DX MCP is enabled side-by-side"),
    ]);
  });

  it("limits side-by-side routing guidance to conflict owners with exposed tools", () => {
    const cwd = workspace();
    const preset = getPreset("headless-360");
    const state = inspectPresetRuntime(cwd, "project", preset);
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: preset.id,
        resolution: "side-by-side",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
        toolPolicy: buildConflictAwareToolPolicy(preset, state.plan),
      }).ok,
    ).toBe(true);

    expect(buildMcpRoutingGuidelines(cwd)).toEqual([
      expect.stringContaining("side-by-side with sf-soql"),
    ]);
    expect(buildMcpRoutingGuidelines(cwd)[0]).not.toContain("sf-apex");
    expect(buildMcpRoutingGuidelines(cwd)[0]).not.toContain("sf-flow");
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
    const preset = getPreset("tableau-next");
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
    const preset = getPreset("tableau-next");
    expect(
      upsertMcpServer(mcpConfigPath(cwd, "project"), preset.serverName, {
        url: "https://api.salesforce.com/platform/mcp/v1/sandbox/analytics/tableau-next",
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

  it("installs a new preset with an explicit read-only tool policy", () => {
    const cwd = workspace();
    const preset = getPreset("headless-360");

    const result = installPreset({
      cwd,
      scope: "project",
      presetId: preset.id,
      resolution: "side-by-side",
      setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      toolPolicy: buildToolExposurePolicy(preset, "read-only"),
    });

    expect(result).toMatchObject({ ok: true, changed: true });
    const written = JSON.parse(readFileSync(mcpConfigPath(cwd, "project"), "utf8"));
    expect(written.mcpServers[preset.serverName]).toMatchObject({
      exposure: "hidden",
      toolExposure: {
        discover: "codemode",
        describe: "codemode",
        dispatch: "hidden",
        dispatch_readonly: "codemode",
      },
    });
  });

  it("updates only tool exposure on an unchanged managed preset", () => {
    const cwd = workspace();
    const preset = getPreset("data360");
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: preset.id,
        resolution: "side-by-side",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);

    const result = updateManagedPresetToolPolicy({
      cwd,
      scope: "project",
      presetId: preset.id,
      policy: buildToolExposurePolicy(preset, "quarantine"),
    });

    expect(result).toMatchObject({ ok: true, changed: true, reloadRequired: true });
    const written = JSON.parse(readFileSync(mcpConfigPath(cwd, "project"), "utf8"));
    expect(written.mcpServers[preset.serverName]).toMatchObject({
      oauth: { clientId: "consumer-key" },
      exposure: "hidden",
      toolExposure: {
        search: "hidden",
        payload_examples: "hidden",
        execute: "hidden",
      },
    });
  });

  it("treats a semantically unchanged recommended policy as a no-op", () => {
    const cwd = workspace();
    const preset = getPreset("data360");
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: preset.id,
        resolution: "side-by-side",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);

    expect(
      updateManagedPresetToolPolicy({
        cwd,
        scope: "project",
        presetId: preset.id,
        policy: buildToolExposurePolicy(preset, "recommended"),
      }),
    ).toMatchObject({ ok: true, changed: false, reloadRequired: false });
  });

  it("refuses tool exposure changes after an external native configuration edit", () => {
    const cwd = workspace();
    const preset = getPreset("data360");
    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: preset.id,
        resolution: "side-by-side",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);
    const file = mcpConfigPath(cwd, "project");
    const root = JSON.parse(readFileSync(file, "utf8"));
    root.mcpServers[preset.serverName].timeout = 30;
    writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`);

    expect(
      updateManagedPresetToolPolicy({
        cwd,
        scope: "project",
        presetId: preset.id,
        policy: buildToolExposurePolicy(preset, "quarantine"),
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("not an unchanged") });
    expect(JSON.parse(readFileSync(file, "utf8")).mcpServers[preset.serverName].timeout).toBe(30);
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

  it("keeps observed but unapproved tools visible without adding them to the reviewed contract", () => {
    const preset = getPreset("data360");
    captureObservedMcpTools([
      {
        name: "mcp__salesforce_data360__search",
        description: "Live search description.",
        exposure: "codemode",
        annotations: { readOnlyHint: true },
      },
      {
        name: "mcp__salesforce_data360__unexpectedWrite",
        description: "Live unapproved description.",
        exposure: "hidden",
        annotations: { readOnlyHint: false, destructiveHint: true },
      },
    ]);

    expect(inspectPresetTools(preset)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "search",
          documented: true,
          observed: true,
          descriptionSource: "observed",
        }),
        expect.objectContaining({
          name: "unexpectedWrite",
          documented: false,
          observed: true,
          exposure: "hidden",
          risk: "destructive",
        }),
      ]),
    );
  });

  it("requires review when observed tools drift from the approved preset contract", () => {
    const cwd = workspace();
    const preset = getPreset("data360");
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
      { name: "mcp__salesforce_data360__search" },
      { name: "mcp__salesforce_data360__unexpectedWrite" },
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
      upsertMcpServer(file, "salesforce-headless-360", { url: "https://example.test/one" }).ok,
    ).toBe(true);
    const root = JSON.parse(readFileSync(file, "utf8"));
    root.mcpServers.salesforce_headless_360 = { url: "https://example.test/two" };
    writeFileSync(file, `${JSON.stringify(root, null, 2)}\n`);

    expect(inspectPresetRuntime(cwd, "project", getPreset("headless-360")).managed).toMatchObject({
      status: "name-conflict",
    });
    expect(
      reconcileCanonicalServerNames({
        cwd,
        scope: "project",
        presetId: "headless-360",
        keepName: "salesforce_headless_360",
      }),
    ).toMatchObject({ ok: true, reloadRequired: true });
  });

  it("leaves an existing legacy SObject entry untouched while installing another preset", () => {
    const cwd = workspace();
    const file = mcpConfigPath(cwd, "project");
    const legacyConfig = {
      url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/sobject-reads",
      exposure: "codemode",
    } as const;
    expect(upsertMcpServer(file, "salesforce-sobject-reads", legacyConfig).ok).toBe(true);

    expect(
      installPreset({
        cwd,
        scope: "project",
        presetId: "headless-360",
        resolution: "enable",
        setup: { environment: "sandbox", oauthClientId: "consumer-key" },
      }).ok,
    ).toBe(true);

    const config = JSON.parse(readFileSync(file, "utf8"));
    expect(config.mcpServers["salesforce-sobject-reads"]).toEqual(legacyConfig);
    expect(config.mcpServers["salesforce-headless-360"]).toBeDefined();
  });
});
