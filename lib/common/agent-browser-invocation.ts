/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared agent-browser invocation resolver. Used by SF Browser and the SF Welcome
 * startup probe so both spawn the CLI the same way.
 */
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Windows: `agent-browser` is a `.cmd` shim that Node cannot spawn directly, and
 * routing through a shell would parse user-supplied arguments (fill values,
 * URLs). Run the npm-installed native exe, or else the package's Node entry
 * point, with an args array instead. Other platforms are unchanged.
 */
export function resolveAgentBrowserInvocation(command: string, args: string[]): [string, string[]] {
  if (process.platform !== "win32" || command !== "agent-browser") return [command, args];
  const appData = process.env.APPDATA;
  if (!appData) return [command, args];
  const packageBin = path.join(appData, "npm", "node_modules", "agent-browser", "bin");
  const nativeExe = path.join(packageBin, "agent-browser-win32-x64.exe");
  if (existsSync(nativeExe)) return [nativeExe, args];
  const entry = path.join(packageBin, "agent-browser.js");
  if (existsSync(entry)) return [process.execPath, [entry, ...args]];
  return [command, args];
}
