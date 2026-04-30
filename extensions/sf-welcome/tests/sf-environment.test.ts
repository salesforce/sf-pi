/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Targeted tests for the welcome-screen environment adapter.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clearPersistedSfEnvironment } from "../../../lib/common/sf-environment/persisted-cache.ts";
import { clearSharedSfEnvironment } from "../../../lib/common/sf-environment/shared-runtime.ts";
import {
  detectSfEnvironment,
  getCachedSfEnvironmentInfo,
  toSfEnvironmentInfo,
  type SfExecFn,
} from "../lib/sf-environment.ts";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-welcome-env-"));
  tempDirs.push(dir);
  return dir;
}

function createExec(
  responses: Record<string, { stdout?: string; stderr?: string; code?: number | null }>,
  calls: string[] = [],
): SfExecFn {
  return async (command, args) => {
    const key = [command, ...args].join(" ");
    calls.push(key);
    const match = responses[key];
    if (!match) {
      throw new Error(`Unexpected command: ${key}`);
    }
    return {
      stdout: match.stdout ?? "",
      stderr: match.stderr ?? "",
      code: match.code ?? 0,
    };
  };
}

afterEach(() => {
  clearSharedSfEnvironment();
  clearPersistedSfEnvironment();

  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectSfEnvironment", () => {
  it("detects CLI, default org, and org details through the shared runtime", async () => {
    process.env.HOME = createTempDir();
    const env = await detectSfEnvironment(
      createExec({
        "sf --version": {
          stdout: "@salesforce/cli/2.130.9 darwin-arm64 node-v22.22.2\n",
        },
        "sf config list --json": {
          stdout: JSON.stringify({
            result: [
              {
                name: "target-org",
                value: "Example-Dev",
                location: "Global",
                success: true,
              },
            ],
          }),
        },
        "sf org display --target-org Example-Dev --json": {
          stdout: JSON.stringify({
            result: {
              alias: "Example-Dev",
              instanceUrl: "https://example--dev.sandbox.my.salesforce.com",
              apiVersion: "66.0",
              connectedStatus: "Connected",
              isSandbox: true,
            },
          }),
        },
      }),
      createTempDir(),
      { force: true },
    );

    expect(env).toMatchObject({
      cliInstalled: true,
      cliVersion: "2.130.9",
      defaultOrg: "Example-Dev",
      orgType: "sandbox",
      connected: true,
      instanceUrl: "https://example--dev.sandbox.my.salesforce.com",
      apiVersion: "66.0",
      configScope: "Global",
      source: "live",
      refreshing: false,
      loading: false,
    });
    expect(typeof env.detectedAt).toBe("number");
  });

  it("prefers configured target-org label and Local scope", async () => {
    process.env.HOME = createTempDir();
    const env = await detectSfEnvironment(
      createExec({
        "sf --version": {
          stdout: "@salesforce/cli/2.130.9 darwin-arm64\n",
        },
        "sf config list --json": {
          stdout: JSON.stringify({
            result: [
              {
                name: "target-org",
                value: "GlobalOrg",
                location: "Global",
                success: true,
              },
              {
                name: "target-org",
                value: "LocalOrg",
                location: "Local",
                success: true,
              },
            ],
          }),
        },
        "sf org display --target-org LocalOrg --json": {
          stdout: JSON.stringify({
            result: {
              alias: "DifferentAlias",
              instanceUrl: "https://acme.develop.my.salesforce.com",
              apiVersion: "65.0",
              connectedStatus: "Disconnected",
            },
          }),
        },
      }),
      createTempDir(),
      { force: true },
    );

    expect(env.defaultOrg).toBe("LocalOrg");
    expect(env.configScope).toBe("Local");
    expect(env.orgType).toBe("developer");
    expect(env.connected).toBe(false);
  });

  it("returns early when the CLI is not installed", async () => {
    process.env.HOME = createTempDir();
    const calls: string[] = [];
    const env = await detectSfEnvironment(
      createExec(
        {
          "sf --version": {
            stdout: "",
            code: 127,
          },
        },
        calls,
      ),
      createTempDir(),
      { force: true },
    );

    expect(env).toMatchObject({
      cliInstalled: false,
      source: "live",
      refreshing: false,
      loading: false,
    });
    expect(calls).toEqual(["sf --version"]);
  });

  it("keeps partial results when org display fails", async () => {
    process.env.HOME = createTempDir();
    const env = await detectSfEnvironment(
      createExec({
        "sf --version": {
          stdout: "@salesforce/cli/2.130.9\n",
        },
        "sf config list --json": {
          stdout: JSON.stringify({
            result: [
              {
                name: "target-org",
                value: "BrokenOrg",
                location: "Global",
                success: true,
              },
            ],
          }),
        },
        "sf org display --target-org BrokenOrg --json": {
          stdout: JSON.stringify({ message: "Authentication failed" }),
          code: 1,
        },
      }),
      createTempDir(),
      { force: true },
    );

    expect(env.cliInstalled).toBe(true);
    expect(env.defaultOrg).toBe("BrokenOrg");
    expect(env.configScope).toBe("Global");
    expect(env.instanceUrl).toBeUndefined();
    expect(env.connected).toBeUndefined();
  });

  it("returns the last persisted snapshot without running detection", async () => {
    process.env.HOME = createTempDir();
    const cwd = createTempDir();

    const expected = await detectSfEnvironment(
      createExec({
        "sf --version": {
          stdout: "@salesforce/cli/2.130.9\n",
        },
        "sf config list --json": {
          stdout: JSON.stringify({
            result: [
              {
                name: "target-org",
                value: "CachedOrg",
                location: "Global",
                success: true,
              },
            ],
          }),
        },
        "sf org display --target-org CachedOrg --json": {
          stdout: JSON.stringify({
            result: {
              alias: "CachedOrg",
              instanceUrl: "https://cached.sandbox.my.salesforce.com",
              apiVersion: "66.0",
              connectedStatus: "Connected",
              isSandbox: true,
            },
          }),
        },
      }),
      cwd,
      { force: true },
    );

    clearSharedSfEnvironment();
    expect(getCachedSfEnvironmentInfo(cwd)).toEqual({
      ...expected,
      source: "cached",
      refreshing: false,
    });
  });
});

describe("toSfEnvironmentInfo", () => {
  it("maps shared environment data to the welcome-screen shape", () => {
    const detectedAt = Date.now();
    const info = toSfEnvironmentInfo(
      {
        cli: { installed: true, version: "2.130.9" },
        project: { detected: true, name: "demo-project" },
        config: { hasTargetOrg: true, targetOrg: "MyDefaultOrg", location: "Global" },
        org: {
          detected: true,
          alias: "SomeAlias",
          orgType: "sandbox",
          connectedStatus: "Connected",
          instanceUrl: "https://example.sandbox.my.salesforce.com",
          apiVersion: "66.0",
        },
        detectedAt,
      },
      { source: "cached", refreshing: true },
    );

    expect(info.defaultOrg).toBe("MyDefaultOrg");
    expect(info.orgType).toBe("sandbox");
    expect(info.connected).toBe(true);
    expect(info.detectedAt).toBe(detectedAt);
    expect(info.source).toBe("cached");
    expect(info.refreshing).toBe(true);
    expect(info.loading).toBe(false);
  });
});
