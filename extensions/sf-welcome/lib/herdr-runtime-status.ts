/* SPDX-License-Identifier: Apache-2.0 */
/** Startup-safe Herdr runtime readiness for the welcome splash. */
import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import { collectHerdrPackageInstall } from "../../../lib/common/herdr-package-sources.ts";
import { getHerdrSplitToolReadiness } from "../../../lib/common/herdr-runtime.ts";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import type { HerdrPiIntegrationStatusInfo, HerdrRuntimeStatusInfo } from "./types.ts";

export { HERDR_PI_PACKAGE_SOURCE } from "../../../lib/common/herdr-package-sources.ts";
export const HERDR_PI_INTEGRATION_FILE = "herdr-agent-state.ts";

export type HerdrStatusExecFn = (
  command: string,
  args: string[],
  options?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string; code: number | null }>;

export async function detectHerdrClientStatus(
  exec: HerdrStatusExecFn,
): Promise<
  Pick<
    HerdrRuntimeStatusInfo,
    "runtimeVersion" | "runtimeChannel" | "runtimeProtocol" | "runtimeVersionLoading"
  >
> {
  try {
    const result = await exec("herdr", ["status", "client"], { timeout: 5_000 });
    if (result.code !== 0) return { runtimeVersionLoading: false };
    return parseHerdrClientStatus(result.stdout || result.stderr);
  } catch {
    return { runtimeVersionLoading: false };
  }
}

export function parseHerdrClientStatus(
  output: string,
): Pick<
  HerdrRuntimeStatusInfo,
  "runtimeVersion" | "runtimeChannel" | "runtimeProtocol" | "runtimeVersionLoading"
> {
  const values = new Map(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([a-z]+):\s*(.+)$/i))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map((match) => [match[1].toLowerCase(), match[2].trim()]),
  );
  const version = values.get("version") || undefined;
  const channel = values.get("channel");
  const protocol = Number.parseInt(values.get("protocol") ?? "", 10);
  return {
    runtimeVersion: version,
    runtimeChannel: channel === "stable" || channel === "preview" ? channel : undefined,
    runtimeProtocol: Number.isFinite(protocol) ? protocol : undefined,
    runtimeVersionLoading: false,
  };
}

export function collectHerdrRuntimeStatus(
  cwd: string | undefined,
  options: {
    activeToolNames?: string[];
    allToolNames?: string[];
    env?: NodeJS.ProcessEnv;
  } = {},
): HerdrRuntimeStatusInfo {
  const env = options.env ?? process.env;
  const extensionEnabled = cwd ? isSfPiExtensionEnabled(cwd, "sf-herdr") : true;
  const activeTools = options.activeToolNames ?? options.allToolNames ?? [];
  const readiness = getHerdrSplitToolReadiness(activeTools, env);
  const toolActive = readiness.allToolsActive;
  const packageInstalled = cwd ? collectHerdrPackageInstall(cwd).providesHerdrTools : false;
  const activeControlEnv = env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID;
  const passiveStatusBridge =
    env.HERDR_ENV === "1" && !!env.HERDR_SOCKET_PATH && !!env.HERDR_PANE_ID;

  const piIntegration = collectHerdrPiIntegrationStatus();

  const kind = !extensionEnabled
    ? "disabled"
    : toolActive && activeControlEnv
      ? "ready"
      : toolActive
        ? "tool-only"
        : packageInstalled
          ? "installed-not-active"
          : "missing";

  return {
    kind,
    extensionEnabled,
    toolActive,
    packageInstalled,
    activeControlEnv,
    passiveStatusBridge,
    piIntegration,
    paneId: typeof env.HERDR_PANE_ID === "string" ? env.HERDR_PANE_ID : undefined,
    controlPackageVersion: readHerdrControlPackageVersion(),
    runtimeVersionLoading: activeControlEnv,
    loading: false,
  };
}

function readHerdrControlPackageVersion(): string | undefined {
  try {
    const packageJson = globalAgentPath(
      "npm",
      "node_modules",
      "@ogulcancelik",
      "pi-herdr",
      "package.json",
    );
    const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

function readFileHeader(filePath: string, maxBytes: number = 2_048): string {
  const fd = openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

export function collectHerdrPiIntegrationStatus(): HerdrPiIntegrationStatusInfo {
  const filePath = globalAgentPath("extensions", HERDR_PI_INTEGRATION_FILE);
  try {
    if (!existsSync(filePath)) {
      return { kind: "missing", path: filePath, loading: false };
    }

    const header = readFileHeader(filePath);
    if (!header.includes("HERDR_INTEGRATION_ID=pi")) {
      return {
        kind: "unknown",
        path: filePath,
        reason: "missing integration marker",
        loading: false,
      };
    }

    const versionMatch = header.match(/HERDR_INTEGRATION_VERSION=(\d+)/);
    return {
      kind: "installed",
      path: filePath,
      version: versionMatch ? Number.parseInt(versionMatch[1], 10) : undefined,
      loading: false,
    };
  } catch {
    return { kind: "unknown", path: filePath, reason: "unreadable", loading: false };
  }
}
