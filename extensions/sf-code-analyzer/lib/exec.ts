/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Code Analyzer exec adapter. Routes `sf` through the shared resolver in
 * `lib/common/sf-invocation.ts` on Windows. Other commands and platforms are
 * unchanged.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";
import { sfCommand } from "../../../lib/common/sf-invocation.ts";

export { resolveSfEntryPoint, sfCommand } from "../../../lib/common/sf-invocation.ts";

export function buildCodeAnalyzerExec(pi: ExtensionAPI, defaultCwd?: string): ExecFn {
  const base = buildExecFn(pi, defaultCwd);
  if (process.platform !== "win32") return base;
  return (command, args, options) => {
    if (command !== "sf") return base(command, args, options);
    const [file, fileArgs] = sfCommand(args);
    return base(file, fileArgs, options);
  };
}
