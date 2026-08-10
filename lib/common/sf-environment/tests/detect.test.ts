/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the Salesforce environment detection chain.
 *
 * Covers: detectCli, detectProject, detectConfig, detectOrg, inferOrgType,
 *         detectEnvironment.
 *
 * - detectCli still shells `sf --version`, so it uses a mock `ExecFn`.
 * - detectConfig and detectOrg now go through `@salesforce/core`, so we
 *   mock the `ConfigAggregator` / `Org` classes rather than spawning a
 *   subprocess.
 * - detectProject is filesystem-only — uses real temp dirs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Mock state for @salesforce/core. Tests reset these in `beforeEach`.
const configGetInfoMock = vi.fn<(key: string) => unknown>();
const configCreateMock = vi.fn();
const connectSalesforceMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  ConfigAggregator: {
    create: () => configCreateMock(),
  },
}));

vi.mock("../../sf-conn/index.ts", () => ({
  connectSalesforce: (options: unknown) => connectSalesforceMock(options),
}));

// orgFromAlias caches Org promises — clear between tests.
beforeEach(async () => {
  configGetInfoMock.mockReset();
  configCreateMock.mockReset();
  configCreateMock.mockResolvedValue({ getInfo: configGetInfoMock });
  connectSalesforceMock.mockReset();
});

import {
  detectCli,
  detectProject,
  detectConfig,
  detectOrg,
  detectEnvironment,
  findProjectFile,
  inferOrgType,
  type ExecFn,
} from "../detect.ts";

// -------------------------------------------------------------------------------------------------
// Mock exec helper (for detectCli only)
// -------------------------------------------------------------------------------------------------

function mockExec(
  overrides: Record<string, { stdout: string; stderr?: string; code?: number | null }>,
): ExecFn {
  return async (command, args) => {
    const key = `${command} ${args.join(" ")}`;
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

/**
 * Build a fake Org-like object that exposes the surface readOrgInfo touches.
 * `authFields` becomes the AuthInfoFields jsforce returns.
 */
function fakeSession(opts: {
  alias?: string;
  username?: string;
  orgId?: string;
  instanceUrl?: string;
  orgType?: "sandbox" | "scratch" | "developer" | "production";
  apiVersion?: string;
  versionSource?: "org-latest" | "configured-fallback";
  namespacePrefix?: string | null;
  orgEdition?: string;
}) {
  return {
    target: {
      targetOrg: opts.alias ?? "RequestedOrg",
      alias: opts.alias,
      username: opts.username,
      orgId: opts.orgId,
      instanceUrl: opts.instanceUrl ?? "https://example.sandbox.my.salesforce.com",
      orgType: opts.orgType ?? "sandbox",
      apiVersion: opts.apiVersion ?? "67.0",
      maxApiVersion: opts.apiVersion ?? "67.0",
      versionSource: opts.versionSource ?? "org-latest",
      namespacePrefix: opts.namespacePrefix,
      orgEdition: opts.orgEdition,
    },
  };
}

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
// detectConfig (ConfigAggregator-backed)
// -------------------------------------------------------------------------------------------------

describe("detectConfig", () => {
  it("returns hasTargetOrg=false when no value is set", async () => {
    configGetInfoMock.mockReturnValue({ value: undefined });
    const result = await detectConfig();
    expect(result.hasTargetOrg).toBe(false);
    expect(result.apiVersion).toBeUndefined();
  });

  it("extracts a Global target-org", async () => {
    configGetInfoMock.mockImplementation((key) =>
      key === "target-org" ? { value: "MyOrg", location: "Global" } : { value: undefined },
    );
    const result = await detectConfig();
    expect(result.hasTargetOrg).toBe(true);
    expect(result.targetOrg).toBe("MyOrg");
    expect(result.location).toBe("Global");
  });

  it("extracts a Local target-org", async () => {
    configGetInfoMock.mockImplementation((key) =>
      key === "target-org" ? { value: "LocalOrg", location: "Local" } : { value: undefined },
    );
    const result = await detectConfig();
    expect(result.targetOrg).toBe("LocalOrg");
    expect(result.location).toBe("Local");
  });

  it("collapses Environment location to Global for the public target-org shape", async () => {
    configGetInfoMock.mockImplementation((key) =>
      key === "target-org" ? { value: "EnvOrg", location: "Environment" } : { value: undefined },
    );
    const result = await detectConfig();
    expect(result.location).toBe("Global");
  });

  it("captures an explicit org-api-version independently from target-org", async () => {
    configGetInfoMock.mockImplementation((key) => {
      if (key === "target-org") return { value: "MyOrg", location: "Global" };
      if (key === "org-api-version") return { value: "50.0", location: "Environment" };
      return { value: undefined };
    });

    const result = await detectConfig();

    expect(result.apiVersion).toBe("50.0");
    expect(result.apiVersionLocation).toBe("Environment");
  });

  it("returns hasTargetOrg=false when ConfigAggregator throws", async () => {
    configCreateMock.mockRejectedValueOnce(new Error("config broken"));
    const result = await detectConfig();
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
// detectOrg (Org-backed)
// -------------------------------------------------------------------------------------------------

describe("detectOrg", () => {
  it("projects shared target facts into OrgInfo", async () => {
    connectSalesforceMock.mockResolvedValueOnce(
      fakeSession({
        alias: "TestOrg",
        username: "user@test.com",
        orgId: "00D000000000001",
        instanceUrl: "https://test.sandbox.my.salesforce.com",
        orgType: "sandbox",
        apiVersion: "67.0",
        namespacePrefix: "pkg",
        orgEdition: "Enterprise Edition",
      }),
    );

    const result = await detectOrg("TestOrg", { cwd: "/workspace" });
    expect(result).toMatchObject({
      detected: true,
      alias: "TestOrg",
      orgType: "sandbox",
      apiVersion: "67.0",
      apiVersionSource: "resolved",
      connectedStatus: "Connected",
      orgId: "00D000000000001",
      namespacePrefix: "pkg",
      orgEdition: "Enterprise Edition",
    });
    expect(connectSalesforceMock).toHaveBeenCalledWith({
      cwd: "/workspace",
      targetOrg: "TestOrg",
      fresh: undefined,
      timeoutMs: 10_000,
    });
  });

  it("maps configured fallback provenance without treating it as an org release", async () => {
    connectSalesforceMock.mockResolvedValueOnce(
      fakeSession({ alias: "PinnedOrg", apiVersion: "62.0", versionSource: "configured-fallback" }),
    );

    const result = await detectOrg("PinnedOrg");
    expect(result.apiVersion).toBe("62.0");
    expect(result.apiVersionSource).toBe("configured");
  });

  it("captures shared connection errors as undetected org state", async () => {
    connectSalesforceMock.mockRejectedValueOnce(new Error("auth expired"));
    const result = await detectOrg("BadOrg");
    expect(result.detected).toBe(false);
    expect(result.error).toContain("auth expired");
    expect(result.orgType).toBe("unknown");
  });
});

// -------------------------------------------------------------------------------------------------
// detectEnvironment (full chain)
// -------------------------------------------------------------------------------------------------

describe("detectEnvironment", () => {
  it("short-circuits when CLI is not installed", async () => {
    const exec = mockExec({ "sf --version": { stdout: "", code: 127 } });
    const dir = createTempDir();
    createSfdxProject(dir);

    const env = await detectEnvironment(exec, dir);
    expect(env.cli.installed).toBe(false);
    expect(env.project.detected).toBe(false);
    expect(env.config.hasTargetOrg).toBe(false);
    expect(env.org.detected).toBe(false);
  });

  it("runs the full chain through the shared Salesforce Connection Module", async () => {
    const exec = mockExec({
      "sf --version": { stdout: "@salesforce/cli/2.130.9 darwin-arm64\n" },
    });
    configGetInfoMock.mockImplementation((key) =>
      key === "target-org" ? { value: "TestOrg", location: "Global" } : { value: undefined },
    );
    connectSalesforceMock.mockResolvedValueOnce(
      fakeSession({ alias: "TestOrg", orgType: "sandbox", apiVersion: "67.0" }),
    );
    const dir = createTempDir();
    createSfdxProject(dir);

    const env = await detectEnvironment(exec, dir);
    expect(env.project.name).toBe("test-project");
    expect(env.config.targetOrg).toBe("TestOrg");
    expect(env.org).toMatchObject({
      detected: true,
      orgType: "sandbox",
      apiVersion: "67.0",
      apiVersionSource: "resolved",
    });
    expect(connectSalesforceMock).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: dir, targetOrg: "TestOrg" }),
    );
  });

  it("skips org resolution when no target-org is configured", async () => {
    const exec = mockExec({ "sf --version": { stdout: "@salesforce/cli/2.130.9\n" } });
    configGetInfoMock.mockReturnValue({ value: undefined });

    const env = await detectEnvironment(exec, createTempDir());
    expect(env.config.hasTargetOrg).toBe(false);
    expect(env.org.detected).toBe(false);
    expect(connectSalesforceMock).not.toHaveBeenCalled();
  });
});
