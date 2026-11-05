/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Code Analyzer exec adapter.
 *
 * On Windows, Node cannot spawn the `sf.cmd` shim directly, so `sf` calls run
 * via `cmd.exe /d /c sf …`. Other commands and platforms are unchanged.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";

export function buildCodeAnalyzerExec(pi: ExtensionAPI, defaultCwd?: string): ExecFn {
  const base = buildExecFn(pi, defaultCwd);
  if (process.platform !== "win32") return base;
  return (command, args, options) =>
    command === "sf"
      ? base("cmd.exe", ["/d", "/c", "sf", ...args], options)
      : base(command, args, options);
}
