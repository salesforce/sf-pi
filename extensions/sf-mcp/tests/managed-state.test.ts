/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { upsertMcpServer, replaceMcpServer } from "../lib/mcp-config.ts";
import {
  createManagedStateStore,
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
  it("distinguishes manual, managed, and externally modified entries", () => {
    const { mcpFile, store } = fixture();
    const config = { command: "npx", args: ["-y", "@salesforce/mcp@latest"] };
    expect(upsertMcpServer(mcpFile, "salesforce-dx", config).ok).toBe(true);

    expect(inspectManagedServer(mcpFile, store, "salesforce-dx").status).toBe("manual");

    recordManagedServer(store, "salesforce-dx", {
      presetId: "salesforce-dx",
      resolution: "enable",
      config,
    });
    expect(inspectManagedServer(mcpFile, store, "salesforce-dx").status).toBe("managed-enabled");

    expect(replaceMcpServer(mcpFile, "salesforce-dx", { command: "custom-wrapper" }).ok).toBe(true);
    expect(inspectManagedServer(mcpFile, store, "salesforce-dx").status).toBe("modified");
  });
});
