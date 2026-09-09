/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPiAuthProviderEnv, readPiAuthProviderStatus } from "../pi-auth-status.ts";

const tempDirs: string[] = [];

function makeAuthFile(body: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-auth-status-"));
  tempDirs.push(dir);
  const file = path.join(dir, "auth.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return file;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readPiAuthProviderStatus", () => {
  it("detects Pi-owned API-key and OAuth credentials without returning values", () => {
    for (const credential of [
      { type: "api_key", key: "secret-key" },
      { type: "oauth", access: "secret-token", refresh: "secret-refresh", expires: Date.now() },
    ]) {
      const file = makeAuthFile({ "sf-docs": credential });

      expect(readPiAuthProviderStatus("sf-docs", file)).toEqual({
        provider: "sf-docs",
        configured: true,
        source: "pi-auth-store",
      });
    }
  });

  it("reports missing or malformed auth stores as status only", () => {
    const missingDir = mkdtempSync(path.join(tmpdir(), "sf-pi-auth-status-"));
    tempDirs.push(missingDir);
    const missing = path.join(missingDir, "auth.json");
    expect(readPiAuthProviderStatus("sf-docs", missing)).toMatchObject({
      configured: false,
      source: "missing",
    });

    const malformed = makeAuthFile("not-json-object");
    writeFileSync(malformed, "{", "utf8");
    expect(readPiAuthProviderStatus("sf-docs", malformed)).toMatchObject({
      configured: false,
      source: "pi-auth-store",
    });
  });

  it("reads a named credential env value without returning secrets", () => {
    const secret = "sfmcp-must-not-return";
    const file = makeAuthFile({
      "sf-docs": {
        type: "api_key",
        key: secret,
        env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
      },
    });

    expect(readPiAuthProviderEnv("sf-docs", "SF_DOCS_MCP_ENDPOINT", file)).toBe(
      "https://docs.example.test/",
    );
    expect(readPiAuthProviderEnv("sf-docs", "key", file)).toBeUndefined();
  });
});
