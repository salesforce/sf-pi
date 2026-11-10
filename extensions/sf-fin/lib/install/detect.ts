/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only Fin CLI detection: binary location, version, install source,
 * npm global root, and the latest published version.
 *
 * Nothing here receives a credential. Every external call is bounded.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import { normalizeNpmConfigValue } from "../../../../lib/common/npm-release-age-policy.ts";
import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";
import { isCliVersionSupported, parseCliVersion } from "../cli-runner.ts";
import { CLI_BINARY, CLI_PACKAGE, MIN_CLI_VERSION } from "../types.ts";
import {
  defaultWindowsSpawnContext,
  resolveSpawnCommand,
  type WindowsSpawnContext,
} from "../../../../lib/common/windows-spawn.ts";

const REGISTRY_URL = "https://registry.npmjs.org/@intercom%2Fcli";
const REGISTRY_TIMEOUT_MS = 5_000;
const EXEC_TIMEOUT_MS = 10_000;

export type CliInstallSource = "npm-global" | "other" | "missing";
export type CliInstallState = "missing" | "below-minimum" | "outdated" | "current" | "unknown";

export interface CliDetection {
  installed: boolean;
  binaryPath?: string;
  installedVersion?: string;
  installSource: CliInstallSource;
  npmGlobalRoot?: string;
  latestVersion?: string;
  state: CliInstallState;
}

export interface NpmRegistryMetadata {
  latest?: string;
  /** Publish time per version, used to honor npm release-age policy. */
  time?: Record<string, string>;
  /** `engines.node` of the latest version, when published. */
  latestNodeEngine?: string;
}

export type FetchRegistryFn = (signal?: AbortSignal) => Promise<NpmRegistryMetadata | undefined>;

export async function fetchCliRegistryMetadata(
  signal?: AbortSignal,
): Promise<NpmRegistryMetadata | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return undefined;
    const json = (await res.json()) as {
      "dist-tags"?: { latest?: string };
      time?: Record<string, string>;
      versions?: Record<string, { engines?: { node?: string } }>;
    };
    const latest = json["dist-tags"]?.latest;
    return {
      latest,
      time: json.time,
      latestNodeEngine: latest ? json.versions?.[latest]?.engines?.node : undefined,
    };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function detectCli(
  exec: ExecFn,
  options: { latestVersion?: string } = {},
  spawnCtx: WindowsSpawnContext = defaultWindowsSpawnContext(),
): Promise<CliDetection> {
  // Windows has no `which`; the resolved npm wrapper target stands in for it.
  // `exec` already runs .cmd wrappers without a shell (lib/common/exec-adapter.ts).
  const windows = spawnCtx.platform === "win32";
  const windowsEntry = windows ? resolveSpawnCommand(CLI_BINARY, spawnCtx).entry : undefined;
  const [which, version, npmRoot] = await Promise.all([
    windows
      ? Promise.resolve(undefined)
      : exec("which", [CLI_BINARY], { timeout: EXEC_TIMEOUT_MS }).catch(() => undefined),
    exec(CLI_BINARY, ["--version"], { timeout: EXEC_TIMEOUT_MS }).catch(() => undefined),
    exec("npm", ["root", "-g"], { timeout: EXEC_TIMEOUT_MS }).catch(() => undefined),
  ]);

  const binaryPath = windows
    ? windowsEntry
    : which?.code === 0
      ? firstLine(which.stdout)
      : undefined;
  const installedVersion = version?.code === 0 ? parseCliVersion(version.stdout) : undefined;
  const npmGlobalRoot = npmRoot?.code === 0 ? firstLine(npmRoot.stdout) : undefined;
  const installed = Boolean(binaryPath || installedVersion);
  const installSource: CliInstallSource = !installed
    ? "missing"
    : isUnderNpmGlobal(binaryPath, npmGlobalRoot, windows ? "win32" : process.platform)
      ? "npm-global"
      : "other";

  return {
    installed,
    binaryPath,
    installedVersion,
    installSource,
    npmGlobalRoot,
    latestVersion: options.latestVersion,
    state: classifyInstallState(installedVersion, installed, options.latestVersion),
  };
}

export function classifyInstallState(
  installedVersion: string | undefined,
  installed: boolean,
  latestVersion: string | undefined,
): CliInstallState {
  if (!installed) return "missing";
  if (!installedVersion) return "unknown";
  if (!isCliVersionSupported(installedVersion, MIN_CLI_VERSION)) return "below-minimum";
  if (latestVersion && !isCliVersionSupported(installedVersion, latestVersion)) return "outdated";
  return "current";
}

/**
 * The npm global bin link resolves into `<npm root -g>/@intercom/cli/...`.
 * Anything else (Homebrew formula, npx cache, manual copy) is unmanaged.
 */
export function isUnderNpmGlobal(
  binaryPath: string | undefined,
  npmGlobalRoot: string | undefined,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!binaryPath || !npmGlobalRoot) return false;
  // Windows paths use `\` and are case-insensitive, so compare with win32 rules there.
  const p = platform === "win32" ? path.win32 : path.posix;
  const fold = (value: string) => (platform === "win32" ? value.toLowerCase() : value);
  const pkgDir = p.join(npmGlobalRoot, ...CLI_PACKAGE.split("/"));
  const target = fold(p.normalize(safeRealpath(binaryPath) ?? binaryPath));
  const root = fold(p.normalize(safeRealpath(pkgDir) ?? pkgDir));
  return target === root || target.startsWith(`${root}${p.sep}`);
}

export interface NpmPolicyConfig {
  before?: string;
  minReleaseAge?: string;
  minimumReleaseAge?: string;
}

export async function readNpmReleaseAgeConfig(exec: ExecFn): Promise<NpmPolicyConfig> {
  const read = async (key: string) => {
    const result = await exec("npm", ["config", "get", key], { timeout: EXEC_TIMEOUT_MS }).catch(
      () => undefined,
    );
    return result?.code === 0 ? normalizeNpmConfigValue(firstLine(result.stdout)) : undefined;
  };
  const [before, minReleaseAge, minimumReleaseAge] = await Promise.all([
    read("before"),
    read("min-release-age"),
    read("minimum-release-age"),
  ]);
  return { before, minReleaseAge, minimumReleaseAge };
}

function firstLine(text: string): string | undefined {
  const line = text.split(/\r?\n/).find((entry) => entry.trim());
  return line?.trim() || undefined;
}

function safeRealpath(value: string): string | undefined {
  try {
    return realpathSync(value);
  } catch {
    return undefined;
  }
}
