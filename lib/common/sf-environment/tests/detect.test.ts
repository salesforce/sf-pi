/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the Salesforce environment detection chain.
 *
 * Covers: detectCli, detectProject, detectConfig, detectOrg, inferOrgType,
 *         parseConfigListResult, parseOrgDisplayResult, detectEnvironment
 *
 * Uses a mock exec function to avoid real CLI calls.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  detectCli,
  detectProject,
  detectOrg,
  detectEnvironment,
  findProjectFile,
  inferOrgType,
  parseConfigListResult,
  parseOrgDisplayResult,
  type ExecFn,
} from "../detect.ts";

// -------------------------------------------------------------------------------------------------
// Mock exec helper
// -------------------------------------------------------------------------------------------------

function mockExec(
  overrides: Record<string, { stdout: string; stderr?: string; code?: number | null }>,
): ExecFn {
  return async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
    // Find a matching key (prefix match for flexibility)
    const match = Object.entries(overrides).find(([k]) => key.startsWith(k));
    if (match) {
      return {
        stdout: match[1].stdout,
        stderr: match[1].stderr ?? "",
        code: match[1].code ?? 0,
      };
    }
    return { stdout: "", stderr: "command not found", code: 127 };
  };
}

// Temp directory management
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-env-test-"));
  tempDirs.push(dir);
  return dir;
}

function createSfdxProject(dir: string, content?: Record<string, unknown>): void {
  const projectJson = {
    packageDirectories: [{ path: "force-app", default: true }],
    name: "test-project",
    namespace: "",
    sourceApiVersion: "66.0",
    ...content,
  };
  writeFileSync(path.join(dir, "sfdx-project.json"), JSON.stringify(projectJson, null, 2));
}

import { afterEach } from "vitest";
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -------------------------------------------------------------------------------------------------
// detectCli
// -------------------------------------------------------------------------------------------------

describe("detectCli", () => {
  it("detects installed CLI with version", async () => {
    const exec = mockExec({
      "sf --version": { stdout: "@salesforce/cli/2.130.9 darwin-arm64 node-v22.22.2\n" },
    });
    const result = await detectCli(exec);
    expect(result.installed).toBe(true);
    expect(result.version).toBe("2.130.9");
  });

  it("returns not installed when command fails", async () => {
    const exec = mockExec({
      "sf --version": { stdout: "", code: 127 },
    });
    const result = await detectCli(exec);
    expect(result.installed).toBe(false);
    expect(result.version).toBeUndefined();
  });

  it("returns not installed when exec throws", async () => {
    const exec: ExecFn = async () => {
      throw new Error("ENOENT");
    };
    const result = await detectCli(exec);
    expect(result.installed).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// detectProject / findProjectFile
// -------------------------------------------------------------------------------------------------

describe("detectProject", () => {
  it("detects a project in the current directory", () => {
    const dir = createTempDir();
    createSfdxProject(dir);

    const result = detectProject(dir);
    expect(result.detected).toBe(true);
    expect(result.name).toBe("test-project");
    expect(result.sourceApiVersion).toBe("66.0");
    expect(result.projectRoot).toBe(dir);
    expect(result.packageDirectories).toHaveLength(1);
    expect(result.packageDirectories![0].path).toBe("force-app");
    expect(result.packageDirectories![0].default).toBe(true);
  });

  it("detects a project in a parent directory", () => {
    const dir = createTempDir();
    createSfdxProject(dir);
    const subdir = path.join(dir, "force-app", "main");
    mkdirSync(subdir, { recursive: true });

    const result = detectProject(subdir);
    expect(result.detected).toBe(true);
    expect(result.projectRoot).toBe(dir);
  });

  it("returns not detected when no project exists", () => {
    const dir = createTempDir();
    const result = detectProject(dir);
    expect(result.detected).toBe(false);
    expect(result.name).toBeUndefined();
  });

  it("reads project name and namespace", () => {
    const dir = createTempDir();
    createSfdxProject(dir, { name: "my-app", namespace: "myns" });

    const result = detectProject(dir);
    expect(result.name).toBe("my-app");
    expect(result.namespace).toBe("myns");
  });

  it("handles empty namespace as undefined", () => {
    const dir = createTempDir();
    createSfdxProject(dir, { namespace: "" });

    const result = detectProject(dir);
    expect(result.namespace).toBeUndefined();
  });

  it("handles malformed JSON gracefully", () => {
    const dir = createTempDir();
    writeFileSync(path.join(dir, "sfdx-project.json"), "not json");

    const result = detectProject(dir);
    expect(result.detected).toBe(true); // File exists
    expect(result.name).toBeUndefined(); // But couldn't parse
  });

  it("reads multiple package directories", () => {
    const dir = createTempDir();
    createSfdxProject(dir, {
      packageDirectories: [
        { path: "force-app", default: true, package: "MyPkg" },
        { path: "unpackaged", default: false },
      ],
    });

    const result = detectProject(dir);
    expect(result.packageDirectories).toHaveLength(2);
    expect(result.packageDirectories![0].package).toBe("MyPkg");
    expect(result.packageDirectories![1].default).toBe(false);
  });
});

describe("findProjectFile", () => {
  it("returns undefined when no project exists", () => {
    const dir = createTempDir();
    expect(findProjectFile(dir)).toBeUndefined();
  });

  it("returns the path when found in current directory", () => {
    const dir = createTempDir();
    createSfdxProject(dir);
    const found = findProjectFile(dir);
    expect(found).toBe(path.join(dir, "sfdx-project.json"));
  });

  it("walks up to find project in parent", () => {
    const parent = createTempDir();
    createSfdxProject(parent);
    const child = path.join(parent, "src", "classes");
    mkdirSync(child, { recursive: true });

    const found = findProjectFile(child);
    expect(found).toBe(path.join(parent, "sfdx-project.json"));
  });
});

// -------------------------------------------------------------------------------------------------
// parseConfigListResult
// -------------------------------------------------------------------------------------------------

describe("parseConfigListResult", () => {
  it("returns hasTargetOrg false for empty entries", () => {
    const result = parseConfigListResult([]);
    expect(result.hasTargetOrg).toBe(false);
  });

  it("extracts global target-org", () => {
    const result = parseConfigListResult([
      { name: "target-org", key: "target-org", value: "MyOrg", location: "Global", success: true },
    ]);
    expect(result.hasTargetOrg).toBe(true);
    expect(result.targetOrg).toBe("MyOrg");
    expect(result.location).toBe("Global");
  });

  it("prefers Local over Global config", () => {
    const result = parseConfigListResult([
      {
        name: "target-org",
        key: "target-org",
        value: "GlobalOrg",
        location: "Global",
        success: true,
      },
      {
        name: "target-org",
        key: "target-org",
        value: "LocalOrg",
        location: "Local",
        success: true,
      },
    ]);
    expect(result.targetOrg).toBe("LocalOrg");
    expect(result.location).toBe("Local");
  });

  it("ignores failed entries", () => {
    const result = parseConfigListResult([
      {
        name: "target-org",
        key: "target-org",
        value: "BadOrg",
        location: "Global",
        success: false,
      },
    ]);
    expect(result.hasTargetOrg).toBe(false);
  });

  it("ignores non-target-org config entries", () => {
    const result = parseConfigListResult([
      {
        name: "target-dev-hub",
        key: "target-dev-hub",
        value: "DevHub",
        location: "Global",
        success: true,
      },
    ]);
    expect(result.hasTargetOrg).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// inferOrgType
// -------------------------------------------------------------------------------------------------

describe("inferOrgType", () => {
  it("detects sandbox from isSandbox flag", () => {
    expect(inferOrgType({ isSandbox: true })).toBe("sandbox");
  });

  it("detects scratch from isScratch flag", () => {
    expect(inferOrgType({ isScratch: true })).toBe("scratch");
  });

  it("detects sandbox from URL pattern", () => {
    expect(inferOrgType({ instanceUrl: "https://company--dev.sandbox.my.salesforce.com" })).toBe(
      "sandbox",
    );
  });

  it("detects developer edition from URL pattern", () => {
    expect(inferOrgType({ instanceUrl: "https://abc-dev-ed.develop.my.salesforce.com" })).toBe(
      "developer",
    );
  });

  it("does not detect developer edition from URL path text", () => {
    expect(inferOrgType({ instanceUrl: "https://example.com/develop.my.salesforce.com" })).toBe(
      "unknown",
    );
  });

  it("detects trial from trailExpirationDate", () => {
    expect(inferOrgType({ trailExpirationDate: "2026-04-22T16:08:39.000+0000" })).toBe("trial");
  });

  it("returns production for DevHub", () => {
    expect(inferOrgType({ isDevHub: true })).toBe("production");
  });

  it("returns unknown when no signals", () => {
    expect(inferOrgType({})).toBe("unknown");
  });

  it("isScratch takes priority over URL", () => {
    expect(
      inferOrgType({ isScratch: true, instanceUrl: "https://x.sandbox.my.salesforce.com" }),
    ).toBe("scratch");
  });
});

// -------------------------------------------------------------------------------------------------
// parseOrgDisplayResult
// -------------------------------------------------------------------------------------------------

describe("parseOrgDisplayResult", () => {
  it("parses a sandbox org display result", () => {
    const result = parseOrgDisplayResult({
      id: "00Dbb000003lx7lEAA",
      apiVersion: "66.0",
      instanceUrl: "https://company--devint.sandbox.my.salesforce.com",
      username: "user@company.com.devint",
      connectedStatus: "Connected",
      alias: "MyOrg-DevInt",
    });

    expect(result.detected).toBe(true);
    expect(result.alias).toBe("MyOrg-DevInt");
    expect(result.orgType).toBe("sandbox");
    expect(result.apiVersion).toBe("66.0");
    expect(result.connectedStatus).toBe("Connected");
  });

  it("parses a dev edition org", () => {
    const result = parseOrgDisplayResult({
      instanceUrl: "https://abc-dev-ed.develop.my.salesforce.com",
      alias: "agentforce",
    });

    expect(result.detected).toBe(true);
    expect(result.orgType).toBe("developer");
  });
});

// -------------------------------------------------------------------------------------------------
// detectOrg
// -------------------------------------------------------------------------------------------------

describe("detectOrg", () => {
  it("parses successful org display", async () => {
    const exec = mockExec({
      "sf org display": {
        stdout: JSON.stringify({
          status: 0,
          result: {
            id: "00D000000000001",
            apiVersion: "66.0",
            instanceUrl: "https://test.sandbox.my.salesforce.com",
            username: "user@test.com",
            connectedStatus: "Connected",
            alias: "TestOrg",
          },
        }),
      },
    });

    const result = await detectOrg(exec, "TestOrg");
    expect(result.detected).toBe(true);
    expect(result.alias).toBe("TestOrg");
    expect(result.orgType).toBe("sandbox");
  });

  it("handles failed org display gracefully", async () => {
    const exec = mockExec({
      "sf org display": {
        stdout: JSON.stringify({ status: 1, message: "No auth found" }),
        code: 1,
      },
    });

    const result = await detectOrg(exec, "BadOrg");
    expect(result.detected).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("handles exec throwing", async () => {
    const exec: ExecFn = async () => {
      throw new Error("timeout");
    };
    const result = await detectOrg(exec, "TimeoutOrg");
    expect(result.detected).toBe(false);
    expect(result.error).toContain("timeout");
  });
});

// -------------------------------------------------------------------------------------------------
// detectEnvironment (full chain)
// -------------------------------------------------------------------------------------------------

describe("detectEnvironment", () => {
  it("short-circuits when CLI is not installed", async () => {
    const exec = mockExec({
      "sf --version": { stdout: "", code: 127 },
    });

    const dir = createTempDir();
    createSfdxProject(dir);

    const env = await detectEnvironment(exec, dir);
    expect(env.cli.installed).toBe(false);
    expect(env.project.detected).toBe(false); // project detection still runs (sync)
    expect(env.config.hasTargetOrg).toBe(false);
    expect(env.org.detected).toBe(false);
  });

  it("runs full chain when CLI is installed", async () => {
    const exec = mockExec({
      "sf --version": { stdout: "@salesforce/cli/2.130.9 darwin-arm64\n" },
      "sf config list": {
        stdout: JSON.stringify({
          status: 0,
          result: [
            {
              name: "target-org",
              key: "target-org",
              value: "TestOrg",
              location: "Global",
              success: true,
            },
          ],
        }),
      },
      "sf org display": {
        stdout: JSON.stringify({
          status: 0,
          result: {
            alias: "TestOrg",
            instanceUrl: "https://test.sandbox.my.salesforce.com",
            connectedStatus: "Connected",
            apiVersion: "66.0",
          },
        }),
      },
    });

    const dir = createTempDir();
    createSfdxProject(dir);

    const env = await detectEnvironment(exec, dir);
    expect(env.cli.installed).toBe(true);
    expect(env.project.detected).toBe(true);
    expect(env.project.name).toBe("test-project");
    expect(env.config.hasTargetOrg).toBe(true);
    expect(env.config.targetOrg).toBe("TestOrg");
    expect(env.org.detected).toBe(true);
    expect(env.org.orgType).toBe("sandbox");
  });

  it("skips org display when no target-org configured", async () => {
    const exec = mockExec({
      "sf --version": { stdout: "@salesforce/cli/2.130.9\n" },
      "sf config list": {
        stdout: JSON.stringify({ status: 0, result: [] }),
      },
    });

    const dir = createTempDir();
    const env = await detectEnvironment(exec, dir);
    expect(env.cli.installed).toBe(true);
    expect(env.config.hasTargetOrg).toBe(false);
    expect(env.org.detected).toBe(false);
  });
});
