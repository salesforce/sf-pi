/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inspectMcpConfig, upsertMcpServer, type McpServerConfig } from "../lib/mcp-config.ts";

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

    expect(inspected).toMatchObject({ ok: true, exists: false, servers: {} });
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
      exposure: "codemode-deferred",
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

  it("refuses to replace malformed JSON", () => {
    const file = tempFile();
    writeFileSync(file, "{ malformed", "utf8");

    const result = upsertMcpServer(file, "salesforce-dx", { command: "npx" });

    expect(result).toMatchObject({ ok: false, reason: "invalid-json" });
    expect(readFileSync(file, "utf8")).toBe("{ malformed");
  });
});
