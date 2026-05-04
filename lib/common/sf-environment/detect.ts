/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure detection functions for the Salesforce environment.
 *
 * Each function handles one layer of the detection chain:
 *   1. detectCli()     — Is sf CLI installed?
 *   2. detectProject() — Is this a Salesforce DX project?
 *   3. detectConfig()  — What's the default target-org?
 *   4. detectOrg()     — What are the org details?
 *
 * All functions are async, side-effect-free (except exec), and return
 * typed results. They never throw — errors are captured in the result.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  CliInfo,
  ConfigInfo,
  OrgInfo,
  OrgType,
  PackageDirectory,
  ProjectInfo,
  SfEnvironment,
} from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Types for CLI JSON output (internal)
// -------------------------------------------------------------------------------------------------

type SfCliResult<T> = {
  status: number;
  result: T;
  warnings?: string[];
};

type ConfigListEntry = {
  name: string;
  key: string;
  value: string;
  location: string;
  success: boolean;
};

type OrgDisplayResult = {
  id?: string;
  apiVersion?: string;
  instanceUrl?: string;
  username?: string;
  connectedStatus?: string;
  alias?: string;
  // Fields from org list (richer)
  isSandbox?: boolean;
  isScratch?: boolean;
  trailExpirationDate?: string;
  isDevHub?: boolean;
};

type SfdxProjectJson = {
  name?: string;
  namespace?: string;
  sourceApiVersion?: string;
  sfdcLoginUrl?: string;
  packageDirectories?: Array<{
    path: string;
    default?: boolean;
    package?: string;
    versionName?: string;
    versionNumber?: string;
  }>;
};

// -------------------------------------------------------------------------------------------------
// Exec helper type (injected for testability)
// -------------------------------------------------------------------------------------------------

export type ExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

// -------------------------------------------------------------------------------------------------
// 1. CLI detection
// -------------------------------------------------------------------------------------------------

export async function detectCli(exec: ExecFn): Promise<CliInfo> {
  try {
    const result = await exec("sf", ["--version"], { timeout: 10_000 });
    if (result.code !== 0) {
      return { installed: false };
    }
    // Output: "@salesforce/cli/2.130.9 darwin-arm64 node-v22.22.2"
    const version =
      result.stdout.trim().split(" ")[0]?.replace("@salesforce/cli/", "") ?? undefined;
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

// -------------------------------------------------------------------------------------------------
// 2. Project detection
// -------------------------------------------------------------------------------------------------

/**
 * Walk up from `cwd` looking for sfdx-project.json.
 * Returns the parsed project info or a "not detected" result.
 */
export function detectProject(cwd: string): ProjectInfo {
  const projectPath = findProjectFile(cwd);
  if (!projectPath) {
    return { detected: false };
  }

  try {
    const raw = readFileSync(projectPath, "utf8");
    const parsed = JSON.parse(raw) as SfdxProjectJson;
    return {
      detected: true,
      projectPath,
      projectRoot: path.dirname(projectPath),
      name: parsed.name ?? path.basename(path.dirname(projectPath)),
      sourceApiVersion: parsed.sourceApiVersion,
      namespace: parsed.namespace || undefined,
      packageDirectories: parsed.packageDirectories?.map(normalizePackageDir),
    };
  } catch {
    // File exists but can't be parsed
    return {
      detected: true,
      projectPath,
      projectRoot: path.dirname(projectPath),
    };
  }
}

/**
 * Walk up from `startDir` looking for sfdx-project.json.
 * Returns the absolute path or undefined.
 */
export function findProjectFile(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, "sfdx-project.json");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return undefined;
}

function normalizePackageDir(raw: {
  path: string;
  default?: boolean;
  package?: string;
  versionName?: string;
  versionNumber?: string;
}): PackageDirectory {
  return {
    path: raw.path,
    default: raw.default,
    package: raw.package,
    versionName: raw.versionName,
    versionNumber: raw.versionNumber,
  };
}

// -------------------------------------------------------------------------------------------------
// 3. Config detection (sf config list)
// -------------------------------------------------------------------------------------------------

export async function detectConfig(exec: ExecFn): Promise<ConfigInfo> {
  try {
    const result = await exec("sf", ["config", "list", "--json"], { timeout: 10_000 });
    if (result.code !== 0) {
      return { hasTargetOrg: false };
    }

    const parsed = JSON.parse(result.stdout) as SfCliResult<ConfigListEntry[]>;
    return parseConfigListResult(parsed.result ?? []);
  } catch {
    return { hasTargetOrg: false };
  }
}

/**
 * Parse the config list entries to find target-org.
 * Local config takes priority over Global (the CLI already handles this,
 * but we track the location for display purposes).
 */
export function parseConfigListResult(entries: ConfigListEntry[]): ConfigInfo {
  // Find target-org entries (there may be both Local and Global)
  const targetOrgEntries = entries.filter((e) => e.name === "target-org" && e.success);

  if (targetOrgEntries.length === 0) {
    return { hasTargetOrg: false };
  }

  // Prefer Local over Global. The .length check above proves targetOrgEntries[0]
  // exists at runtime, but TS's noUncheckedIndexedAccess still reports it as
  // possibly-undefined; guard it explicitly instead of using a non-null
  // assertion so strict lints stay clean.
  const local = targetOrgEntries.find((e) => e.location === "Local");
  const entry = local ?? targetOrgEntries[0];
  if (!entry) {
    // Unreachable: the length guard above rules this out, but the guard
    // keeps TS and the lint happy without a non-null assertion.
    return { hasTargetOrg: false };
  }

  return {
    hasTargetOrg: true,
    targetOrg: entry.value,
    location: entry.location === "Local" ? "Local" : "Global",
  };
}

// -------------------------------------------------------------------------------------------------
// 4. Org detection (sf org display)
// -------------------------------------------------------------------------------------------------

export async function detectOrg(exec: ExecFn, targetOrg: string): Promise<OrgInfo> {
  try {
    const result = await exec("sf", ["org", "display", "--target-org", targetOrg, "--json"], {
      timeout: 15_000,
    });

    if (result.code !== 0) {
      // Try to extract error message from JSON
      try {
        const errorJson = JSON.parse(result.stdout) as { message?: string };
        return {
          detected: false,
          orgType: "unknown",
          error: errorJson.message ?? `sf org display failed (exit ${result.code})`,
        };
      } catch {
        return {
          detected: false,
          orgType: "unknown",
          error: `sf org display failed (exit ${result.code})`,
        };
      }
    }

    const parsed = JSON.parse(result.stdout) as SfCliResult<OrgDisplayResult>;
    return parseOrgDisplayResult(parsed.result ?? {});
  } catch (err) {
    return {
      detected: false,
      orgType: "unknown",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Parse sf org display JSON result into typed OrgInfo.
 * Determines org type from instance URL patterns and flags.
 */
export function parseOrgDisplayResult(result: OrgDisplayResult): OrgInfo {
  return {
    detected: true,
    alias: result.alias,
    username: result.username,
    orgId: result.id,
    instanceUrl: result.instanceUrl,
    orgType: inferOrgType(result),
    connectedStatus: result.connectedStatus,
    apiVersion: result.apiVersion,
  };
}

/**
 * Infer org type from the available signals.
 *
 * Detection order (most specific → least):
 *   1. Explicit flags (isScratch, isSandbox)
 *   2. Instance URL patterns (.sandbox., .scratch.)
 *   3. Trial expiration date
 *   4. Default: "production" if nothing else matches
 */
export function inferOrgType(info: {
  isScratch?: boolean;
  isSandbox?: boolean;
  instanceUrl?: string;
  trailExpirationDate?: string;
  isDevHub?: boolean;
}): OrgType {
  // Explicit flags
  if (info.isScratch) return "scratch";
  if (info.isSandbox) return "sandbox";

  // URL patterns. Parse the host before matching so arbitrary text in the
  // scheme/path/query cannot influence org-type detection.
  const hostname = getInstanceHostname(info.instanceUrl);
  if (hostname) {
    const labels = hostname.split(".");
    if (labels.includes("sandbox")) return "sandbox";
    if (labels.includes("scratch")) return "scratch";
    if (
      hostname === "develop.my.salesforce.com" ||
      hostname.endsWith(".develop.my.salesforce.com")
    ) {
      return "developer";
    }
  }

  // Trial detection
  if (info.trailExpirationDate) return "trial";

  // If it's a DevHub, it's likely production
  if (info.isDevHub) return "production";

  return "unknown";
}

function getInstanceHostname(instanceUrl: string | undefined): string | null {
  if (!instanceUrl) return null;
  try {
    return new URL(instanceUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------------------
// Full detection chain
// -------------------------------------------------------------------------------------------------

/**
 * Run the full detection chain: CLI → Project → Config → Org.
 *
 * Each layer short-circuits if the previous layer failed:
 *   - No CLI → skip everything
 *   - No target-org → skip org display
 */
export async function detectEnvironment(exec: ExecFn, cwd: string): Promise<SfEnvironment> {
  // Layer 1: CLI
  const cli = await detectCli(exec);

  if (!cli.installed) {
    return {
      cli,
      project: { detected: false },
      config: { hasTargetOrg: false },
      org: { detected: false, orgType: "unknown" },
      detectedAt: Date.now(),
    };
  }

  // Layer 2: Project (synchronous, no CLI needed)
  const project = detectProject(cwd);

  // Layer 3: Config
  const config = await detectConfig(exec);

  // Layer 4: Org (only if we have a target-org)
  let org: OrgInfo;
  if (config.hasTargetOrg && config.targetOrg) {
    org = await detectOrg(exec, config.targetOrg);
  } else {
    org = { detected: false, orgType: "unknown" };
  }

  return { cli, project, config, org, detectedAt: Date.now() };
}
