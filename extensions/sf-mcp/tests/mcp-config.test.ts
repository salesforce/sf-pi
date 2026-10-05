/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectMcpConfig,
  removeCanonicalMcpServerDuplicates,
  upsertMcpServer,
  type McpServerConfig,
} from "../lib/mcp-config.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-mcp-config-"));
  tempDirs.push(dir);
  return path.join(dir, "mcp.json");
}

describe("native Pi MCP configuration", () => {
  it("is absent and empty by default", () => {
    const inspected = inspectMcpConfig(tempFile());

    expect(inspected).toMatchObject({ ok: true, exists: false, servers: {}, overrides: {} });
  });

  it("separates Pi project overrides from complete server definitions", () => {
    const file = tempFile();
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          mcpServers: {
            "salesforce-headless-360": {
              enabled: false,
              exposure: "hidden",
              toolExposure: { discover: "codemode" },
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    expect(inspectMcpConfig(file)).toMatchObject({
      ok: true,
      servers: {},
      overrides: {
        "salesforce-headless-360": {
          enabled: false,
          exposure: "hidden",
          toolExposure: { discover: "codemode" },
        },
      },
    });

    expect(upsertMcpServer(file, "salesforce-dx", { command: "npx" }).ok).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8")).mcpServers["salesforce-headless-360"]).toEqual({
      enabled: false,
      exposure: "hidden",
      toolExposure: { discover: "codemode" },
    });
  });

  it("adds one server without discarding unrelated native MCP configuration", () => {
    const file = tempFile();
    writeFileSync(
      file,
      `${JSON.stringify({ autoEnableCodemode: false, mcpServers: { existing: { url: "https://example.test/mcp" } } }, null, 2)}\n`,
      "utf8",
    );
    const config: McpServerConfig = {
      command: "npx",
      args: [
        "-y",
        "@salesforce/mcp@latest",
        "--orgs",
        "DEFAULT_TARGET_ORG",
        "--toolsets",
        "orgs,metadata,users",
      ],
      description: "Salesforce DX metadata and org operations",
      exposure: "codemode",
    };

    const result = upsertMcpServer(file, "salesforce-dx", config);
    const written = JSON.parse(readFileSync(file, "utf8"));

    expect(result).toMatchObject({ ok: true, created: true });
    expect(written.autoEnableCodemode).toBe(false);
    expect(written.mcpServers.existing).toEqual({ url: "https://example.test/mcp" });
    expect(written.mcpServers["salesforce-dx"]).toEqual(config);
  });

  it("refuses to overwrite an existing manually configured server", () => {
    const file = tempFile();
    writeFileSync(
      file,
      `${JSON.stringify({ mcpServers: { "salesforce-dx": { command: "custom-wrapper" } } }, null, 2)}\n`,
      "utf8",
    );

    const result = upsertMcpServer(file, "salesforce-dx", {
      command: "npx",
      args: ["-y", "@salesforce/mcp@latest"],
    });

    expect(result).toMatchObject({ ok: false, reason: "server-exists" });
    expect(JSON.parse(readFileSync(file, "utf8")).mcpServers["salesforce-dx"]).toEqual({
      command: "custom-wrapper",
    });
  });

  it("refuses a server name that collides after Pi namespace normalization", () => {
    const file = tempFile();
    writeFileSync(
      file,
      `${JSON.stringify({ mcpServers: { salesforce_headless_360: { url: "https://example.test/mcp" } } }, null, 2)}\n`,
      "utf8",
    );

    const result = upsertMcpServer(file, "salesforce-headless-360", {
      url: "https://api.salesforce.com/platform/mcp/v1/sandbox/platform/headless-360",
    });

    expect(result).toMatchObject({ ok: false, reason: "server-name-conflict" });
  });

  it("removes canonical duplicates only after naming the entry to keep", () => {
    const file = tempFile();
    writeFileSync(
      file,
      `${JSON.stringify(
        {
          mcpServers: {
            "salesforce-headless-360": { url: "https://example.test/one" },
            salesforce_headless_360: { url: "https://example.test/two" },
            unrelated: { url: "https://example.test/other" },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const result = removeCanonicalMcpServerDuplicates(
      file,
      "salesforce-headless-360",
      "salesforce_headless_360",
    );
    const written = JSON.parse(readFileSync(file, "utf8"));

    expect(result).toMatchObject({ ok: true });
    expect(written.mcpServers).not.toHaveProperty("salesforce-headless-360");
    expect(written.mcpServers.salesforce_headless_360).toBeDefined();
    expect(written.mcpServers.unrelated).toBeDefined();
  });

  it("refuses to replace malformed JSON", () => {
    const file = tempFile();
    writeFileSync(file, "{ malformed", "utf8");

    const result = upsertMcpServer(file, "salesforce-dx", { command: "npx" });

    expect(result).toMatchObject({ ok: false, reason: "invalid-json" });
    expect(readFileSync(file, "utf8")).toBe("{ malformed");
  });
});
