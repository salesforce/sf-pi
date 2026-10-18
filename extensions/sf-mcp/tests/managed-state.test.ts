/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { upsertMcpServer, replaceMcpServer } from "../lib/mcp-config.ts";
import {
  createManagedStateStore,
  fingerprintConfig,
  inspectManagedServer,
  recordManagedServer,
} from "../lib/managed-state.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-mcp-managed-"));
  tempDirs.push(dir);
  return {
    mcpFile: path.join(dir, "mcp.json"),
    store: createManagedStateStore(process.cwd(), "global", path.join(dir, "managed.json")),
  };
}

describe("SF MCP managed preset state", () => {
  it("fingerprints public OAuth identifiers deterministically and detects config drift", () => {
    const config = { url: "https://mcp.example.test/mcp", oauth: { clientId: "public-client-id" } };
    const fingerprint = fingerprintConfig(config);
    expect(fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(fingerprintConfig({ oauth: config.oauth, url: config.url })).toBe(fingerprint);
    expect(
      fingerprintConfig({ ...config, oauth: { clientId: "another-public-client-id" } }),
    ).not.toBe(fingerprint);
    const { store } = fixture();
    recordManagedServer(store, "example", {
      presetId: "headless-360",
      presetRevision: 1,
      resolution: "enable",
      config,
    });
    const serialized = JSON.stringify(store.read());
    expect(serialized).toContain(fingerprint);
    expect(serialized).not.toContain("public-client-id");
  });

  it("distinguishes manual, managed, and externally modified entries", () => {
    const { mcpFile, store } = fixture();
    const config = { command: "npx", args: ["-y", "@salesforce/mcp@latest"] };
    expect(upsertMcpServer(mcpFile, "salesforce-dx", config).ok).toBe(true);

    expect(
      inspectManagedServer(mcpFile, store, {
        serverName: "salesforce-dx",
        presetId: "salesforce-dx",
        presetRevision: 1,
        scope: "global",
      }).status,
    ).toBe("manual");

    recordManagedServer(store, "salesforce-dx", {
      presetId: "salesforce-dx",
      presetRevision: 1,
      resolution: "enable",
      config,
    });
    expect(
      inspectManagedServer(mcpFile, store, {
        serverName: "salesforce-dx",
        presetId: "salesforce-dx",
        presetRevision: 1,
        scope: "global",
      }).status,
    ).toBe("managed-enabled");

    expect(
      inspectManagedServer(mcpFile, store, {
        serverName: "salesforce-dx",
        presetId: "salesforce-dx",
        presetRevision: 2,
        scope: "global",
      }).status,
    ).toBe("managed-outdated");

    expect(replaceMcpServer(mcpFile, "salesforce-dx", { command: "custom-wrapper" }).ok).toBe(true);
    expect(
      inspectManagedServer(mcpFile, store, {
        serverName: "salesforce-dx",
        presetId: "salesforce-dx",
        presetRevision: 2,
        scope: "global",
      }).status,
    ).toBe("modified");
  });
});
