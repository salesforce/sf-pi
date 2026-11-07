/* SPDX-License-Identifier: Apache-2.0 */
/** Cache-first Hunk readiness for the welcome splash. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createStateStore } from "../../../lib/common/state-store.ts";
import type { HunkStatusInfo } from "./types.ts";

export type HunkExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const HUNK_COMMANDS = ["hunk", "hunkdiff"] as const;
type HunkCommand = (typeof HUNK_COMMANDS)[number];

/** Test seams. Production callers pass nothing. */
export interface HunkDetectOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Node binary that runs the Windows entry point. Defaults to the running Node. */
  nodePath?: string;
}

interface HunkStatusCacheFile {
  status?: HunkStatusInfo;
  savedAt?: number;
}

const DEFAULT_STATUS: HunkStatusInfo = {
  installed: false,
  loading: true,
};

function getCacheStore() {
  return createStateStore<HunkStatusCacheFile>({
    namespace: "sf-welcome",
    filename: "hunk-status.json",
    schemaVersion: 1,
    defaults: {},
    migrate(raw, fromVersion) {
      if (fromVersion !== 0) return null;
      return raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as HunkStatusCacheFile)
        : null;
    },
  });
}

export function defaultHunkStatus(): HunkStatusInfo {
  return { ...DEFAULT_STATUS };
}

export function readCachedHunkStatus(maxAgeMs: number = CACHE_MAX_AGE_MS): HunkStatusInfo | null {
  try {
    const cache = getCacheStore().read();
    if (typeof cache.savedAt !== "number") return null;
    if (Date.now() - cache.savedAt > maxAgeMs) return null;
    return parseCachedStatus(cache.status);
  } catch {
    return null;
  }
}

export function writeCachedHunkStatus(status: HunkStatusInfo): HunkStatusInfo {
  const displayReady = {
    ...status,
    loading: false,
    checkedAt: status.checkedAt ?? new Date().toISOString(),
  };
  try {
    getCacheStore().write({ status: displayReady, savedAt: Date.now() });
  } catch {
    // Best-effort. The splash falls back to a non-blocking nudge.
  }
  return displayReady;
}

export async function detectHunkStatus(
  exec: HunkExecFn,
  options: HunkDetectOptions = {},
): Promise<HunkStatusInfo> {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return detectWindowsHunkStatus(exec, options);

  for (const command of HUNK_COMMANDS) {
    try {
      const result = await exec(command, ["--version"], { timeout: 10_000 });
      if (result.code !== 0) continue;
      return installedStatus(command, result);
    } catch {
      // Try the next binary name.
    }
  }

  return notInstalledStatus();
}

/**
 * On Windows npm installs `hunk` as a `.cmd` shim. Pi's exec does not use a
 * shell, so it cannot run a shim by bare name (ENOENT). Run the package's Node
 * entry point instead, the same approach as the Salesforce CLI resolver. No
 * shell, and no PATHEXT lookup.
 */
async function detectWindowsHunkStatus(
  exec: HunkExecFn,
  options: HunkDetectOptions,
): Promise<HunkStatusInfo> {
  const env = options.env ?? process.env;
  const resolved = resolveWindowsHunkEntry(env.PATH ?? env.Path);
  if (!resolved) return notInstalledStatus();
  try {
    const result = await exec(options.nodePath ?? process.execPath, [resolved.entry, "--version"], {
      timeout: 10_000,
    });
    if (result.code === 0) return installedStatus(resolved.command, result);
  } catch {
    // Fall through to not installed.
  }
  return notInstalledStatus();
}

/**
 * Find the hunk package behind the first `hunk.cmd` or `hunkdiff.cmd` on PATH.
 * npm global layout: `<prefix>\hunk.cmd` sits next to `<prefix>\node_modules\hunkdiff`.
 * Returns the absolute path of the entry point declared in that package.json.
 */
export function resolveWindowsHunkEntry(
  pathValue: string | undefined,
): { command: HunkCommand; entry: string } | null {
  for (const dir of (pathValue ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const command of HUNK_COMMANDS) {
      if (!existsSync(path.join(dir, `${command}.cmd`))) continue;
      const entry = hunkEntryFromPackage(path.join(dir, "node_modules", "hunkdiff"), command);
      if (entry) return { command, entry };
    }
  }
  return null;
}

function hunkEntryFromPackage(pkgDir: string, command: HunkCommand): string | null {
  const pkgPath = path.join(pkgDir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { bin?: unknown };
    const bin = pkg.bin;
    let relative: unknown;
    if (typeof bin === "string") {
      relative = bin;
    } else if (bin && typeof bin === "object") {
      const map = bin as Record<string, unknown>;
      relative = map[command] ?? map.hunk;
    }
    if (typeof relative !== "string") return null;
    const entry = path.resolve(pkgDir, relative);
    return existsSync(entry) ? entry : null;
  } catch {
    return null;
  }
}

function installedStatus(
  command: HunkCommand,
  result: { stdout: string; stderr: string },
): HunkStatusInfo {
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    installed: true,
    command,
    installedVersion: parseHunkVersion(output),
    loading: false,
    checkedAt: new Date().toISOString(),
  };
}

function notInstalledStatus(): HunkStatusInfo {
  return {
    installed: false,
    loading: false,
    checkedAt: new Date().toISOString(),
  };
}

export function parseHunkVersion(output: string): string | undefined {
  const match = /v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/.exec(output.trim());
  return match?.[1]?.replace(/^v/, "");
}

function parseCachedStatus(value: unknown): HunkStatusInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<HunkStatusInfo>;
  if (typeof record.installed !== "boolean") return null;
  return {
    installed: record.installed,
    command:
      record.command === "hunk" || record.command === "hunkdiff" ? record.command : undefined,
    installedVersion:
      typeof record.installedVersion === "string" ? record.installedVersion : undefined,
    loading: false,
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : undefined,
  };
}
