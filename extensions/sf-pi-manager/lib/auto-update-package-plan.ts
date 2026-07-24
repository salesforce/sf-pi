/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only compatibility preflight for Pi-owned npm package updates. */
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { compareVersions } from "../../../lib/common/pi-compat.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { globalSettingsPath, readJsonFile } from "../../../lib/common/sf-pi-settings.ts";

const PACKAGE_METADATA_TIMEOUT_MS = 15_000;
const PACKAGE_METADATA_CONCURRENCY = 4;
const MAX_PACKAGE_PREFLIGHTS = 20;
const PI_PEER = "@earendil-works/pi-coding-agent";
const NPM_PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/i;

export interface PiPackageUpdatePlan {
  sources: string[];
  configuredCount: number;
  eligibleCount: number;
  currentCount: number;
  skippedCount: number;
}

export interface PiPackageUpdatePlanOptions {
  piVersion: string | undefined;
  nodeVersion?: string;
  signal?: AbortSignal;
}

export async function planCompatiblePiPackageUpdates(
  pi: ExtensionAPI,
  _cwd: string,
  options: PiPackageUpdatePlanOptions,
): Promise<PiPackageUpdatePlan> {
  const settings = readJsonFile(globalSettingsPath());
  const sources = configuredPackageSources(settings);
  const plan: PiPackageUpdatePlan = {
    sources: [],
    configuredCount: sources.length,
    eligibleCount: 0,
    currentCount: 0,
    skippedCount: 0,
  };

  if (!options.piVersion || hasCustomNpmCommand(settings)) {
    plan.skippedCount = sources.length;
    return plan;
  }

  const candidates: Array<{ source: string; name: string }> = [];
  for (const source of sources) {
    const npmSource = parseUnpinnedNpmSource(source);
    if (!npmSource) plan.skippedCount += 1;
    else candidates.push({ source, name: npmSource.name });
  }

  const boundedCandidates = candidates.slice(0, MAX_PACKAGE_PREFLIGHTS);
  plan.skippedCount += candidates.length - boundedCandidates.length;
  const checks = await mapWithConcurrency(
    boundedCandidates,
    PACKAGE_METADATA_CONCURRENCY,
    async (candidate) => {
      if (options.signal?.aborted) return { kind: "skipped" as const, source: candidate.source };
      const metadata = await readLatestMetadata(
        pi,
        globalAgentPath(),
        candidate.name,
        options.signal,
      );
      if (
        !metadata ||
        !metadata.piPeerRanges.every((range) => isDeclaredPiCompatible(range, options.piVersion)) ||
        (metadata.nodeEngine !== undefined &&
          !isDeclaredVersionCompatible(
            metadata.nodeEngine,
            options.nodeVersion ?? process.versions.node,
          )) ||
        !isVersion(metadata.version)
      ) {
        return { kind: "skipped" as const, source: candidate.source };
      }
      const installedVersion = readInstalledVersion(candidate.name);
      if (installedVersion && compareVersions(installedVersion, metadata.version) >= 0) {
        return { kind: "current" as const, source: candidate.source };
      }
      return { kind: "eligible" as const, source: candidate.source };
    },
  );

  for (const check of checks) {
    if (check.kind === "eligible") plan.sources.push(check.source);
    else if (check.kind === "current") plan.currentCount += 1;
    else plan.skippedCount += 1;
  }
  plan.eligibleCount = plan.sources.length;
  return plan;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(values[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function configuredPackageSources(settings: Record<string, unknown>): string[] {
  if (!Array.isArray(settings.packages)) return [];
  const sources = settings.packages
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
      const source = (entry as Record<string, unknown>).source;
      return typeof source === "string" ? source.trim() : "";
    })
    .filter(Boolean);
  return [...new Set(sources)];
}

function hasCustomNpmCommand(settings: Record<string, unknown>): boolean {
  return typeof settings.npmCommand === "string" && settings.npmCommand.trim() !== "npm";
}

function parseUnpinnedNpmSource(source: string): { name: string } | undefined {
  if (!source.startsWith("npm:")) return undefined;
  const spec = source.slice(4);
  if (!spec) return undefined;
  const versionSeparator = spec.lastIndexOf("@");
  if (spec.startsWith("@")) {
    const slash = spec.indexOf("/");
    if (slash < 2) return undefined;
    if (versionSeparator > slash) return undefined;
  } else if (versionSeparator > 0) {
    return undefined;
  }
  if (!NPM_PACKAGE_NAME_RE.test(spec)) return undefined;
  return { name: spec };
}

async function readLatestMetadata(
  pi: ExtensionAPI,
  cwd: string,
  packageName: string,
  signal?: AbortSignal,
): Promise<{ version: string; piPeerRanges: string[]; nodeEngine?: string } | undefined> {
  try {
    const result = await pi.exec(
      "npm",
      ["view", `${packageName}@latest`, "version", "peerDependencies", "engines", "--json"],
      { cwd, timeout: PACKAGE_METADATA_TIMEOUT_MS, signal },
    );
    if (result.code !== 0 || result.killed || signal?.aborted) return undefined;
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    const peers =
      parsed.peerDependencies &&
      typeof parsed.peerDependencies === "object" &&
      !Array.isArray(parsed.peerDependencies)
        ? (parsed.peerDependencies as Record<string, unknown>)
        : {};
    const engines =
      parsed.engines && typeof parsed.engines === "object" && !Array.isArray(parsed.engines)
        ? (parsed.engines as Record<string, unknown>)
        : {};
    const version = parsed.version;
    const piPeer = peers[PI_PEER];
    const piPeerRanges = Object.entries(peers)
      .filter(([name]) => name.startsWith("@earendil-works/pi-"))
      .map(([, range]) => range);
    const nodeEngine = engines.node;
    if (
      typeof version !== "string" ||
      typeof piPeer !== "string" ||
      piPeerRanges.some((range) => typeof range !== "string")
    ) {
      return undefined;
    }
    return {
      version,
      piPeerRanges: piPeerRanges as string[],
      nodeEngine: typeof nodeEngine === "string" ? nodeEngine : undefined,
    };
  } catch {
    return undefined;
  }
}

function readInstalledVersion(packageName: string): string | undefined {
  try {
    const packageJson = globalAgentPath(
      "npm",
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as Record<string, unknown>;
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

export function isDeclaredPiCompatible(range: string, version: string): boolean {
  return isDeclaredVersionCompatible(range, version);
}

function isDeclaredVersionCompatible(range: string, version: string): boolean {
  const normalized = range.trim();
  if (normalized === "*") return true;
  if (/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    return compareVersions(version, normalized) === 0;
  }
  if (normalized.includes("||")) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  return tokens.every((token) => {
    const match = token.match(/^(>=|<=|>|<|=)(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/);
    if (!match) return false;
    const comparison = compareVersions(version, match[2]);
    if (match[1] === ">=") return comparison >= 0;
    if (match[1] === "<=") return comparison <= 0;
    if (match[1] === ">") return comparison > 0;
    if (match[1] === "<") return comparison < 0;
    return comparison === 0;
  });
}

function isVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}
