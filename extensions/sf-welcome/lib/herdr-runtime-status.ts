/* SPDX-License-Identifier: Apache-2.0 */
/** Startup-safe Herdr runtime readiness for the welcome splash. */
import { closeSync, existsSync, openSync, readSync } from "node:fs";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import { isRecommendedPackageSourceInstalled } from "./recommendations-status.ts";
import type { HerdrPiIntegrationStatusInfo, HerdrRuntimeStatusInfo } from "./types.ts";

export const HERDR_PI_PACKAGE_SOURCE = "npm:@ogulcancelik/pi-herdr";
export const HERDR_PI_INTEGRATION_FILE = "herdr-agent-state.ts";

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
  const activeTools = new Set(options.activeToolNames ?? []);
  const allTools = new Set(options.allToolNames ?? []);
  const toolActive =
    activeTools.has("herdr") || (options.activeToolNames === undefined && allTools.has("herdr"));
  const packageInstalled = cwd
    ? isRecommendedPackageSourceInstalled(cwd, HERDR_PI_PACKAGE_SOURCE)
    : false;
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
    loading: false,
  };
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
