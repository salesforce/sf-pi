/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mcpConfigPath, upsertMcpServer } from "../lib/mcp-config.ts";
import { buildMcpRoutingGuidelines, installPreset, inspectPresetRuntime } from "../lib/service.ts";
import { getPreset } from "../lib/presets.ts";

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
      exposure: "hidden",
      toolExposure: {
        createSobjectRecord: "codemode-deferred",
        updateSobjectRecord: "codemode-deferred",
      },
    });
    expect(
      inspectPresetRuntime(cwd, "project", getPreset("sobject-mutations")).managed.status,
    ).toBe("managed-enabled");
  });
});
