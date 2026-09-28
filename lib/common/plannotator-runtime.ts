/* SPDX-License-Identifier: Apache-2.0 */
/** On-demand Plannotator TUI readiness, shared by sf-welcome and sf-planreview. */
import { statSync } from "node:fs";
import path from "node:path";
import { createStateStore } from "./state-store.ts";
import { managedTuiIntegrity, managedTuiPath, TUI_VERSION } from "./plannotator-release.ts";

export interface PlannotatorRuntimeStatus {
  installed: boolean;
  standaloneReady: boolean;
  herdrReady: boolean;
  managedState: "missing" | "verified" | "damaged" | "unsupported";
  herdrState: "ready" | "missing" | "lite" | "disabled" | "broken" | "unverified" | "unavailable";
  version?: string;
  /** Resolved at invocation time only; never persisted as an installation promise. */
  binaryPath?: string;
  loading: boolean;
  checkedAt?: string;
}

export type PlannotatorExec = (
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Cache {
  status?: PlannotatorRuntimeStatus;
  savedAt?: number;
}

function store() {
  return createStateStore<Cache>({
    namespace: "sf-planreview",
    filename: "status.json",
    schemaVersion: 2,
    defaults: {},
  });
}

export function defaultPlannotatorRuntime(): PlannotatorRuntimeStatus {
  return {
    installed: false,
    standaloneReady: false,
    herdrReady: false,
    managedState: "missing",
    herdrState: "missing",
    loading: true,
  };
}

export function readCachedPlannotatorRuntime(
  maxAgeMs: number = CACHE_MAX_AGE_MS,
): PlannotatorRuntimeStatus | null {
  const cache = store().read();
  if (typeof cache.savedAt !== "number" || Date.now() - cache.savedAt > maxAgeMs) return null;
  const value = cache.status;
  if (
    !value ||
    typeof value.installed !== "boolean" ||
    typeof value.standaloneReady !== "boolean" ||
    typeof value.herdrReady !== "boolean"
  )
    return null;
  return {
    ...value,
    managedState: value.managedState ?? "missing",
    herdrState: value.herdrState ?? (value.herdrReady ? "ready" : "missing"),
    binaryPath: undefined,
    loading: false,
  };
}

export function writeCachedPlannotatorRuntime(status: PlannotatorRuntimeStatus): void {
  const publicStatus = { ...status };
  delete publicStatus.binaryPath;
  store().write({ status: { ...publicStatus, loading: false }, savedAt: Date.now() });
}

export async function detectPlannotatorRuntime(
  exec: PlannotatorExec,
): Promise<PlannotatorRuntimeStatus> {
  const standalone = await versionOf(exec, "plannotator-tui");
  const managedPath = managedTuiPath();
  let managedState = managedTuiIntegrity();
  const managedVersion =
    managedState === "verified" && isExecutable(managedPath)
      ? await versionOf(exec, managedPath)
      : undefined;
  if (managedState === "verified" && managedVersion !== TUI_VERSION) managedState = "damaged";

  let herdrState: PlannotatorRuntimeStatus["herdrState"] = "missing";
  let herdrBinary: string | undefined;
  let herdrVersion: string | undefined;
  try {
    const result = await exec("herdr", ["plugin", "list", "--json"], { timeout: 5_000 });
    if (result.code !== 0) {
      herdrState = "unavailable";
    } else {
      const parsed = JSON.parse(result.stdout) as {
        result?: { plugins?: Array<Record<string, unknown>> };
      };
      const plugin = parsed.result?.plugins?.find((item) => item.plugin_id === "annotate");
      if (plugin) {
        const source = plugin.source as Record<string, unknown> | undefined;
        if (
          source?.kind !== "github" ||
          source.owner !== "plannotator" ||
          source.repo !== "herdr-annotate"
        ) {
          herdrState = "unverified";
        } else if (plugin.enabled !== true) {
          herdrState = "disabled";
        } else if (
          !Array.isArray(plugin.panes) ||
          !plugin.panes.some((pane) => (pane as { id?: unknown }).id === "doc") ||
          !Array.isArray(plugin.actions) ||
          !plugin.actions.some((action) => (action as { id?: unknown }).id === "open")
        ) {
          herdrState = "lite";
        } else if (typeof plugin.plugin_root !== "string" || !path.isAbsolute(plugin.plugin_root)) {
          herdrState = "broken";
        } else {
          const binary = path.join(plugin.plugin_root, "bin", "plannotator-tui.exe");
          if (isExecutable(binary)) herdrVersion = await versionOf(exec, binary);
          if (herdrVersion) {
            herdrState = "ready";
            herdrBinary = binary;
          } else {
            herdrState = "broken";
          }
        }
      }
    }
  } catch {
    herdrState = "unavailable";
  }
  const inHerdr = process.env.HERDR_ENV === "1" && !!process.env.HERDR_PANE_ID;
  const version = (inHerdr && herdrVersion) || managedVersion || standalone || herdrVersion;
  const binaryPath = managedVersion ? managedPath : standalone ? "plannotator-tui" : herdrBinary;
  return {
    installed: !!version,
    standaloneReady: !!standalone || !!managedVersion,
    herdrReady: herdrState === "ready",
    managedState,
    herdrState,
    version,
    binaryPath,
    loading: false,
    checkedAt: new Date().toISOString(),
  };
}

function isExecutable(file: string): boolean {
  try {
    const stat = statSync(file);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function versionOf(exec: PlannotatorExec, command: string): Promise<string | undefined> {
  try {
    const result = await exec(command, ["--version"], { timeout: 5_000 });
    if (result.code !== 0) return undefined;
    return /plannotator-tui\s+v?(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/i.exec(
      `${result.stdout}\n${result.stderr}`,
    )?.[1];
  } catch {
    return undefined;
  }
}
