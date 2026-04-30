/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the persisted Salesforce environment cache.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearPersistedSfEnvironment,
  getEnvironmentCacheKey,
  readPersistedSfEnvironment,
  writePersistedSfEnvironment,
} from "../persisted-cache.ts";
import type { SfEnvironment } from "../types.ts";

const originalHome = process.env.HOME;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createEnv(version: string = "2.130.9"): SfEnvironment {
  return {
    cli: { installed: true, version },
    project: { detected: true, projectRoot: "/tmp/project", name: "demo" },
    config: { hasTargetOrg: true, targetOrg: "DemoOrg", location: "Global" },
    org: {
      detected: true,
      alias: "DemoOrg",
      orgType: "sandbox",
      connectedStatus: "Connected",
      instanceUrl: "https://demo.sandbox.my.salesforce.com",
      apiVersion: "66.0",
    },
    detectedAt: Date.now(),
  };
}

afterEach(() => {
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

describe("persisted Salesforce environment cache", () => {
  it("writes and reads a cached environment", () => {
    process.env.HOME = createTempDir("sf-org-cache-home-");
    const cwd = createTempDir("sf-org-cache-cwd-");
    const env = createEnv();

    writePersistedSfEnvironment(cwd, env);

    expect(readPersistedSfEnvironment(cwd)).toEqual(env);
  });

  it("keys nested folders by Salesforce project root", () => {
    process.env.HOME = createTempDir("sf-org-cache-home-");
    const projectRoot = createTempDir("sf-org-cache-project-");
    const nested = path.join(projectRoot, "force-app", "main", "default");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      path.join(projectRoot, "sfdx-project.json"),
      JSON.stringify({ packageDirectories: [{ path: "force-app", default: true }] }, null, 2),
      "utf8",
    );

    expect(getEnvironmentCacheKey(nested)).toBe(projectRoot);
  });

  it("clears a single cached environment without removing others", () => {
    process.env.HOME = createTempDir("sf-org-cache-home-");
    const first = createTempDir("sf-org-cache-first-");
    const second = createTempDir("sf-org-cache-second-");

    writePersistedSfEnvironment(first, createEnv("2.130.9"));
    writePersistedSfEnvironment(second, createEnv("2.131.0"));

    clearPersistedSfEnvironment(first);

    expect(readPersistedSfEnvironment(first)).toBeNull();
    expect(readPersistedSfEnvironment(second)?.cli.version).toBe("2.131.0");
  });
});
