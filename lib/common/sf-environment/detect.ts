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
 * `lib/common/sf-conn/connection.ts`. Only `detectCli` still shells out (it's
 * the only honest answer to "is sf on PATH?").
 *
 * All functions are async, side-effect-free (except detectCli's exec), and
 * return typed results. They never throw — errors are captured in the result.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Config reads remain lazy so importing environment status code does not load
// the Salesforce SDK or contact an org on the boot path.
import type { ConfigAggregator as ConfigAggregatorClass } from "@salesforce/core";
import { connectSalesforce, getCachedSalesforceTarget } from "../sf-conn/index.ts";

const DETECT_ORG_TIMEOUT_MS = 10_000;

let configAggregatorCtor: typeof ConfigAggregatorClass | undefined;
async function getConfigAggregatorCtor(): Promise<typeof ConfigAggregatorClass> {
  if (configAggregatorCtor) return configAggregatorCtor;
  const mod = await import("@salesforce/core");
  configAggregatorCtor = mod.ConfigAggregator;
  return configAggregatorCtor;
}
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
 */
export async function detectConfig(cwd?: string): Promise<ConfigInfo> {
  try {
    const ConfigAggregator = await getConfigAggregatorCtor();
    const aggregator = await ConfigAggregator.create(cwd ? { projectPath: cwd } : undefined);
    const targetInfo = aggregator.getInfo("target-org");
    const apiVersionInfo = aggregator.getInfo("org-api-version");
    const targetOrg =
      typeof targetInfo?.value === "string" && targetInfo.value ? targetInfo.value : undefined;
    const apiVersion =
      typeof apiVersionInfo?.value === "string" && apiVersionInfo.value
        ? apiVersionInfo.value
        : undefined;

    return {
      hasTargetOrg: Boolean(targetOrg),
      targetOrg,
      // ConfigAggregator.Location is "Local" | "Global" | "Environment".
      // The previous `sf config list` flow only emitted Local | Global for
      // target-org, so collapse Environment into Global for that legacy field.
      location: targetOrg ? (targetInfo?.location === "Local" ? "Local" : "Global") : undefined,
      apiVersion,
      apiVersionLocation: normalizeConfigLocation(apiVersionInfo?.location),
    };
  } catch {
    return { hasTargetOrg: false };
  }
}

function normalizeConfigLocation(
  location: unknown,
): "Local" | "Global" | "Environment" | undefined {
  return location === "Local" || location === "Global" || location === "Environment"
    ? location
    : undefined;
}

// -------------------------------------------------------------------------------------------------
// 4. Org detection (`@salesforce/core` Org)
// -------------------------------------------------------------------------------------------------

/**
 * Resolve local/cached org details for status presentation. Only an explicit
 * refresh performs authoritative API-version discovery.
 */
export interface DetectOrgOptions {
  /** Recreate the shared target session. Used only by explicit user refreshes. */
  freshConnection?: boolean;
  cwd?: string;
}

export async function detectOrg(
  targetOrg: string,
  options: DetectOrgOptions = {},
): Promise<OrgInfo> {
  try {
    const cwd = options.cwd ?? process.cwd();
    if (options.freshConnection) {
      const session = await connectSalesforce({
        cwd,
        targetOrg,
        fresh: true,
        timeoutMs: DETECT_ORG_TIMEOUT_MS,
      });
      return {
        detected: true,
        alias: session.target.alias ?? targetOrg,
        username: session.target.username,
        orgId: session.target.orgId,
        instanceUrl: session.target.instanceUrl,
        orgType: session.target.orgType,
        connectedStatus: "Connected",
        apiVersion: session.target.apiVersion,
        apiVersionSource: session.target.versionSource === "org-latest" ? "resolved" : "configured",
        namespacePrefix: session.target.namespacePrefix,
        orgEdition: session.target.orgEdition,
      };
    }

    const target = await getCachedSalesforceTarget({
      cwd,
      targetOrg,
      timeoutMs: DETECT_ORG_TIMEOUT_MS,
    });
    return {
      detected: true,
      alias: target.alias ?? targetOrg,
      username: target.username,
      orgId: target.orgId,
      instanceUrl: target.instanceUrl,
      orgType: target.orgType,
      connectedStatus: "Connected",
      apiVersion: target.apiVersion,
      apiVersionSource: target.apiVersionSource,
      namespacePrefix: target.namespacePrefix,
      orgEdition: target.orgEdition,
    };
  } catch (err) {
    return {
      detected: false,
      orgType: "unknown",
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
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
export interface DetectEnvironmentOptions {
  /** Recreate the resolved target Org instead of reusing the shared connection cache. */
  freshOrgConnection?: boolean;
}

export async function detectEnvironment(
  exec: ExecFn,
  cwd: string,
  options: DetectEnvironmentOptions = {},
): Promise<SfEnvironment> {
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
  const config = await detectConfig(cwd);

  // Layer 4: Org (local/cache-first unless this is an explicit deep refresh)
  let org: OrgInfo;
  if (config.hasTargetOrg && config.targetOrg) {
    org = await detectOrg(config.targetOrg, {
      cwd,
      freshConnection: options.freshOrgConnection,
    });
  } else {
    org = { detected: false, orgType: "unknown" };
  }

  return { cli, project, config, org, detectedAt: Date.now() };
}
