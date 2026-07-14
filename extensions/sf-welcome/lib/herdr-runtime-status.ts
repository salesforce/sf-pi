/* SPDX-License-Identifier: Apache-2.0 */
/** Startup-safe Herdr runtime readiness for the welcome splash. */
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import type { HerdrRuntimeStatusInfo } from "./types.ts";

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
  const activeControlEnv = env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID;
  const passiveStatusBridge =
    env.HERDR_ENV === "1" && !!env.HERDR_SOCKET_PATH && !!env.HERDR_PANE_ID;

  const kind = !extensionEnabled
    ? "disabled"
    : toolActive && activeControlEnv
      ? "ready"
      : toolActive
        ? "tool-only"
        : "missing";

  return {
    kind,
    extensionEnabled,
    toolActive,
    activeControlEnv,
    passiveStatusBridge,
    paneId: typeof env.HERDR_PANE_ID === "string" ? env.HERDR_PANE_ID : undefined,
    loading: false,
  };
}
