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
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import type { ExecFn } from "../../../lib/common/sf-environment/detect.ts";

const SF_RESOLUTION_TTL_MS = 60_000;
const sfResolutionCache = new Map<string, { value: [string, string[]] | null; at: number }>();

export interface SfResolutionEnv {
  PATH?: string;
  LOCALAPPDATA?: string;
}

/** The oclif entry script in a client's `bin` folder: `run.js`, or legacy `run`. */
function oclifRunScript(binDir: string): string | undefined {
  for (const name of ["run.js", "run"]) {
    const candidate = path.join(binDir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** A Salesforce CLI client folder that ships its own `bin\node.exe`. */
function bundledClient(clientDir: string): [string, string[]] | null {
  const binDir = path.join(clientDir, "bin");
  const node = path.join(binDir, "node.exe");
  const run = oclifRunScript(binDir);
  return existsSync(node) && run ? [node, ["--no-deprecation", run]] : null;
}

/**
 * The installer's `sf.cmd` first redirects to the auto-updated client at
 * `%LOCALAPPDATA%\sf\client\bin\sf.cmd`, which forwards to a versioned folder
 * (for example `..\2.153.5-abc1234\bin\sf.cmd`). Follow that redirect so we run
 * the same version the shell would.
 */
function autoUpdatedClient(localAppData: string | undefined): [string, string[]] | null {
  if (!localAppData) return null;
  const redirect = path.join(localAppData, "sf", "client", "bin", "sf.cmd");
  if (!existsSync(redirect)) return null;
  const text = readFileSync(redirect, "utf8");
  const match = /\.\.\\([^\\"]+)\\bin\\sf\.cmd/i.exec(text);
  if (!match) return null;
  return bundledClient(path.join(localAppData, "sf", "client", match[1]));
}

/**
 * Find the Node entry point behind the first `sf.cmd` on PATH. Supports:
 * - the Salesforce CLI installer (`bin\sf.cmd` + `client\bin\node.exe` + `run.js`),
 *   including its redirect to the auto-updated client under `%LOCALAPPDATA%`;
 * - the npm global layout (`node_modules\@salesforce\cli\bin\run.js`).
 * Cached per PATH value for a short TTL so PATH is not rescanned on every call.
 */
export function resolveSfEntryPoint(
  env: SfResolutionEnv = process.env,
  now: number = Date.now(),
): [string, string[]] | null {
  const key = `${env.PATH ?? ""}\u0000${env.LOCALAPPDATA ?? ""}`;
  const cached = sfResolutionCache.get(key);
  if (cached && now - cached.at < SF_RESOLUTION_TTL_MS) return cached.value;

  let value: [string, string[]] | null = null;
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (!dir || !existsSync(path.join(dir, "sf.cmd"))) continue;
    const installerClient = path.join(dir, "..", "client");
    if (existsSync(path.join(installerClient, "bin", "node.exe"))) {
      value = autoUpdatedClient(env.LOCALAPPDATA) ?? bundledClient(installerClient);
      if (value) break;
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
