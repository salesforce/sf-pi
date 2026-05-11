/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pure detection functions for the Salesforce environment.
 *
 * Each function handles one layer of the detection chain:
 *   1. detectCli()     — Is sf CLI installed? (subprocess: `sf --version`)
 *   2. detectProject() — Is this a Salesforce DX project? (filesystem)
 *   3. detectConfig()  — What's the default target-org? (`@salesforce/core` ConfigAggregator)
 *   4. detectOrg()     — What are the org details? (`@salesforce/core` Org)
 *
 * Layers 3 and 4 used to shell `sf config list --json` / `sf org display --json`.
 * They now use `@salesforce/core` directly, sharing auth files with the sf CLI
 * but skipping the subprocess + JSON parse — measured ~30× lower latency, and
 * the `Connection` is reusable by downstream callers via the cache in
 * `lib/common/sf-conn/connection.ts`.
 *
 * The `ExecFn` parameter on `detectConfig` / `detectOrg` is preserved for
 * back-compat with callers that still pass it; it is unused by those layers.
 *
 * All functions are async, side-effect-free (except detectCli's exec), and
 * return typed results. They never throw — errors are captured in the result.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ConfigAggregator, Org } from "@salesforce/core";
import { orgFromAlias } from "../sf-conn/connection.ts";
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
// Types for sfdx-project.json (internal)
// -------------------------------------------------------------------------------------------------

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
  options?: { timeout?: number; cwd?: string },
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
// 3. Config detection (`@salesforce/core` ConfigAggregator)
// -------------------------------------------------------------------------------------------------

/**
 * Resolve the default target-org via `ConfigAggregator`. Reads the same
 * `~/.sfdx/config.json` + project `.sf/config.json` files the `sf` CLI does;
 * just skips the subprocess + JSON parse.
 *
 * The `_exec` parameter is preserved for back-compat with callers that still
 * pass it; it is unused.
 */
export async function detectConfig(_exec?: ExecFn): Promise<ConfigInfo> {
  try {
    const aggregator = await ConfigAggregator.create();
    const info = aggregator.getInfo("target-org");
    const value = info?.value;
    if (typeof value !== "string" || !value) {
      return { hasTargetOrg: false };
    }
    return {
      hasTargetOrg: true,
      targetOrg: value,
      // ConfigAggregator.Location is "Local" | "Global" | "Environment".
      // The previous `sf config list` flow only emitted Local | Global, so
      // collapse Environment into Global to keep the public shape stable.
      location: info?.location === "Local" ? "Local" : "Global",
    };
  } catch {
    return { hasTargetOrg: false };
  }
}

// -------------------------------------------------------------------------------------------------
// 4. Org detection (`@salesforce/core` Org)
// -------------------------------------------------------------------------------------------------

/**
 * Resolve org details for `targetOrg` via the cached `Org`. No subprocess.
 *
 * The `_exec` parameter is preserved for back-compat with callers that still
 * pass it; it is unused.
 */
export async function detectOrg(_exec: ExecFn | undefined, targetOrg: string): Promise<OrgInfo> {
  try {
    const org = await orgFromAlias(targetOrg);
    return readOrgInfo(org, targetOrg);
  } catch (err) {
    return {
      detected: false,
      orgType: "unknown",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Read every field we care about off a resolved `Org` instance.
 *
 * Mirrors the shape the old `sf org display --json` parser produced. We
 * deliberately don't issue an extra REST call here — `Org.create` already
 * succeeded against the auth files, which matches the offline behavior of
 * `sf org display`.
 */
function readOrgInfo(org: Org, requestedAlias: string): OrgInfo {
  const conn = org.getConnection();
  const fields = conn.getAuthInfoFields() as {
    instanceUrl?: string;
    username?: string;
    orgId?: string;
    alias?: string;
    isSandbox?: boolean;
    isScratch?: boolean;
    isDevHub?: boolean;
    trailExpirationDate?: string | null;
  };

  const instanceUrl = fields.instanceUrl ?? conn.instanceUrl;
  return {
    detected: true,
    alias: fields.alias ?? requestedAlias,
    username: fields.username,
    orgId: fields.orgId,
    instanceUrl,
    orgType: inferOrgType({
      isSandbox: fields.isSandbox,
      isScratch: fields.isScratch,
      isDevHub: fields.isDevHub,
      instanceUrl,
      trailExpirationDate: fields.trailExpirationDate ?? undefined,
    }),
    connectedStatus: "Connected",
    apiVersion: conn.getApiVersion(),
  };
}

/**
 * Infer org type from the available signals.
 *
 * Detection order (most specific → least):
 *   1. Explicit flags (isScratch, isSandbox)
 *   2. Instance URL patterns (.sandbox., .scratch.)
 *   3. Trial expiration date
 *   4. Default: "production" if it's a DevHub; "unknown" otherwise.
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
 *   - No CLI → skip everything (sf CLI is required at minimum to login)
 *   - No target-org → skip org display
 *
 * After this change, only `detectCli` shells out. Config + Org go through
 * `@salesforce/core` directly, so cold start drops from 3 subprocess calls
 * to 1.
 */
export async function detectEnvironment(exec: ExecFn, cwd: string): Promise<SfEnvironment> {
  // Layer 1: CLI (subprocess — only honest answer to "is sf on PATH?")
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

  // Layer 2: Project (synchronous filesystem walk)
  const project = detectProject(cwd);

  // Layer 3: Config (in-process, ConfigAggregator)
  const config = await detectConfig();

  // Layer 4: Org (in-process, cached Org/Connection)
  let org: OrgInfo;
  if (config.hasTargetOrg && config.targetOrg) {
    org = await detectOrg(undefined, config.targetOrg);
  } else {
    org = { detected: false, orgType: "unknown" };
  }

  return { cli, project, config, org, detectedAt: Date.now() };
}
