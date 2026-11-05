/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Code Analyzer exec adapter.
 *
 * On Windows, `sf` is a `.cmd` shim. Node cannot spawn shims without a shell,
 * and a shell would parse user-supplied arguments (scan targets, paths). So on
 * win32 we resolve the real Node entry point behind `sf.cmd` and run that
 * directly with an args array: no `cmd.exe`, no `shell: true`.
 *
 * Other commands and platforms are unchanged.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";

const SF_RESOLUTION_TTL_MS = 60_000;
const sfResolutionCache = new Map<string, { value: [string, string[]] | null; at: number }>();

/**
 * Find the Node entry point behind `sf.cmd` on PATH. Supports the Salesforce
 * CLI installer layout (`client\bin\node.exe` + `client\bin\run`) and the npm
 * global layout (`node_modules\@salesforce\cli\bin\run.js`). Cached per PATH
 * value for a short TTL so PATH is not rescanned on every call.
 */
export function resolveSfEntryPoint(
  pathEnv: string | undefined = process.env.PATH,
  now: number = Date.now(),
): [string, string[]] | null {
  const key = pathEnv ?? "";
  const cached = sfResolutionCache.get(key);
  if (cached && now - cached.at < SF_RESOLUTION_TTL_MS) return cached.value;

  let value: [string, string[]] | null = null;
  for (const dir of key.split(path.delimiter)) {
    if (!dir || !existsSync(path.join(dir, "sf.cmd"))) continue;
    const clientBin = path.join(dir, "..", "client", "bin");
    const clientNode = path.join(clientBin, "node.exe");
    const clientRun = path.join(clientBin, "run");
    if (existsSync(clientNode) && existsSync(clientRun)) {
      value = [clientNode, ["--no-deprecation", clientRun]];
      break;
    }
    const npmRun = path.join(dir, "node_modules", "@salesforce", "cli", "bin", "run.js");
    if (existsSync(npmRun)) {
      value = [process.execPath, [npmRun]];
      break;
    }
  }
  sfResolutionCache.set(key, { value, at: now });
  return value;
}

/**
 * Map an `sf` invocation to a process that can be spawned without a shell.
 * Returns the original command when no Windows entry point is found, so the
 * caller reports the usual "not found" error instead of guessing.
 */
export function sfCommand(args: string[]): [string, string[]] {
  if (process.platform !== "win32") return ["sf", args];
  const entry = resolveSfEntryPoint();
  return entry ? [entry[0], [...entry[1], ...args]] : ["sf", args];
}

export function buildCodeAnalyzerExec(pi: ExtensionAPI, defaultCwd?: string): ExecFn {
  const base = buildExecFn(pi, defaultCwd);
  if (process.platform !== "win32") return base;
  return (command, args, options) => {
    if (command !== "sf") return base(command, args, options);
    const [file, fileArgs] = sfCommand(args);
    return base(file, fileArgs, options);
  };
}
