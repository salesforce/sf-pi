/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared cache for the external agent-browser runtime used by SF Browser.
 *
 * SF Browser writes this cache from explicit doctor/probe flows. SF Welcome
 * reads it cache-first on startup so the splash can orient users without
 * launching Chrome/CDP or blocking first paint.
 */
import { createStateStore } from "../state-store.ts";
import { compareVersions } from "../catalog-state/whats-new.ts";

export type BrowserRuntimeFreshness = "checking" | "latest" | "update-available" | "unknown";

export type BrowserRuntimeInstallSource = "homebrew" | "npm" | "unknown";

export interface BrowserRuntimeStatusInfo {
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  freshness: BrowserRuntimeFreshness;
  loading: boolean;
  checkedAt?: string;
  checkSkipped?: boolean;
  skipReason?: "offline" | "version-check-disabled";
  installSource?: BrowserRuntimeInstallSource;
  binaryPath?: string;
}

export type BrowserRuntimeExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export type BrowserRuntimeFetchLatestFn = (signal?: AbortSignal) => Promise<string | undefined>;

const NPM_REGISTRY_LATEST_URL = "https://registry.npmjs.org/agent-browser/latest";
const NPM_REGISTRY_TIMEOUT_MS = 5_000;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface BrowserRuntimeStatusCacheFile {
  status?: BrowserRuntimeStatusInfo;
  savedAt?: number;
}

const DEFAULT_STATUS: BrowserRuntimeStatusInfo = {
  installed: false,
  freshness: "checking",
  loading: true,
};

function getCacheStore() {
  return createStateStore<BrowserRuntimeStatusCacheFile>({
    namespace: "sf-browser",
    filename: "agent-browser-status.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as BrowserRuntimeStatusCacheFile)
        : null;
    },
  });
}

export function defaultBrowserRuntimeStatus(): BrowserRuntimeStatusInfo {
  return { ...DEFAULT_STATUS };
}

export function readCachedBrowserRuntimeStatus(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): BrowserRuntimeStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedBrowserRuntimeStatus(
  status: BrowserRuntimeStatusInfo,
): BrowserRuntimeStatusInfo {
  const displayReady = {
    ...status,
    loading: false,
    checkedAt: status.checkedAt ?? new Date().toISOString(),
  };
  try {
    getCacheStore().write({ status: displayReady, savedAt: Date.now() });
  } catch {
    // Cache is best-effort; browser operations should not depend on disk.
  }
  return displayReady;
}

export function parseAgentBrowserVersion(output: string): string | undefined {
  const match = /v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/.exec(output.trim());
  return match?.[1]?.replace(/^v/, "");
}

export async function fetchLatestAgentBrowserVersion(
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const timeoutSignal = AbortSignal.timeout(NPM_REGISTRY_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(NPM_REGISTRY_LATEST_URL, {
      signal: combined,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { version?: unknown };
    if (typeof payload.version !== "string") return undefined;
    const trimmed = payload.version.trim().replace(/^v/, "");
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}

export async function detectBrowserRuntimeStatus(
  exec: BrowserRuntimeExecFn,
  fetchLatest: BrowserRuntimeFetchLatestFn = fetchLatestAgentBrowserVersion,
  env: NodeJS.ProcessEnv = process.env,
): Promise<BrowserRuntimeStatusInfo> {
  let installedVersion: string | undefined;
  try {
    const versionResult = await exec("agent-browser", ["--version"], { timeout: 15_000 });
    if (versionResult.code !== 0) {
      return { installed: false, freshness: "unknown", loading: false, checkedAt: nowIso() };
    }
    installedVersion = parseAgentBrowserVersion(
      [versionResult.stdout, versionResult.stderr].filter(Boolean).join("\n"),
    );
  } catch {
    return { installed: false, freshness: "unknown", loading: false, checkedAt: nowIso() };
  }

  if (env.PI_OFFLINE) {
    return {
      installed: true,
      installedVersion,
      freshness: "unknown",
      loading: false,
      checkedAt: nowIso(),
      checkSkipped: true,
      skipReason: "offline",
    };
  }
  if (env.PI_SKIP_VERSION_CHECK) {
    return {
      installed: true,
      installedVersion,
      freshness: "unknown",
      loading: false,
      checkedAt: nowIso(),
      checkSkipped: true,
      skipReason: "version-check-disabled",
    };
  }

  const latestVersion = await fetchLatest();
  const freshness =
    latestVersion && installedVersion
      ? compareVersions(installedVersion, latestVersion) >= 0
        ? "latest"
        : "update-available"
      : "unknown";
  const source = freshness === "update-available" ? await detectInstallSource(exec) : undefined;

  return {
    installed: true,
    installedVersion,
    latestVersion,
    freshness,
    loading: false,
    checkedAt: nowIso(),
    installSource: source?.installSource,
    binaryPath: source?.binaryPath,
  };
}

async function detectInstallSource(exec: BrowserRuntimeExecFn): Promise<{
  installSource: BrowserRuntimeInstallSource;
  binaryPath?: string;
}> {
  let binaryPath: string | undefined;
  try {
    const which = await exec("which", ["agent-browser"], { timeout: 5_000 });
    if (which.code === 0) binaryPath = which.stdout.trim() || undefined;
  } catch {
    // Optional source hint only.
  }

  try {
    const brew = await exec("brew", ["list", "--formula", "agent-browser"], { timeout: 5_000 });
    if (brew.code === 0) return { installSource: "homebrew", binaryPath };
  } catch {
    // Homebrew may not be installed.
  }

  try {
    const npm = await exec("npm", ["ls", "-g", "--depth=0", "agent-browser", "--json"], {
      timeout: 5_000,
    });
    if (npm.code === 0 && npm.stdout.includes('"agent-browser"')) {
      return { installSource: "npm", binaryPath };
    }
  } catch {
    // npm may not be installed or the package may not be npm-owned.
  }

  return { installSource: "unknown", binaryPath };
}

function parseCachedStatus(value: unknown): BrowserRuntimeStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<BrowserRuntimeStatusInfo>;
  if (typeof record.installed !== "boolean") return null;
  if (!isFreshness(record.freshness)) return null;
  return {
    installed: record.installed,
    installedVersion:
      typeof record.installedVersion === "string" ? record.installedVersion : undefined,
    latestVersion: typeof record.latestVersion === "string" ? record.latestVersion : undefined,
    freshness: record.freshness,
    loading: false,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : undefined,
    checkSkipped: record.checkSkipped === true,
    skipReason:
      record.skipReason === "offline" || record.skipReason === "version-check-disabled"
        ? record.skipReason
        : undefined,
    installSource:
      record.installSource === "homebrew" ||
      record.installSource === "npm" ||
      record.installSource === "unknown"
        ? record.installSource
        : undefined,
    binaryPath: typeof record.binaryPath === "string" ? record.binaryPath : undefined,
  };
}

function isFreshness(value: unknown): value is BrowserRuntimeFreshness {
  return (
    value === "checking" ||
    value === "latest" ||
    value === "update-available" ||
    value === "unknown"
  );
}

function nowIso(): string {
  return new Date().toISOString();
}
