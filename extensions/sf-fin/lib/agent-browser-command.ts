/* SPDX-License-Identifier: Apache-2.0 */
/**
 * How SF Fin starts agent-browser.
 *
 * macOS and Linux: `agent-browser` by name, or through `sh -c 'umask 077; …'`
 * for a launch that will hold a Fin login, so its files are created owner-only.
 *
 * Windows: npm installs `agent-browser.cmd`, which Node can't spawn without a
 * shell, so a bare-name spawn fails with ENOENT. `umask` has no effect on NTFS,
 * and `sh` is only present when Git Bash is on PATH. So on win32 every launch
 * runs the program the shim points at: the native `agent-browser-win32-x64.exe`,
 * or `node agent-browser.js` for other installs. Access to those files is
 * governed by the user profile's inherited ACLs.
 *
 * Platform, PATH, and file access are injectable so both branches are testable
 * on any runner.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface AgentBrowserContext {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (file: string) => boolean;
  readText: (file: string) => string;
  /** Node binary for a JavaScript entry. Defaults to the running Node. */
  nodePath: string;
}

export function defaultAgentBrowserContext(): AgentBrowserContext {
  return {
    platform: process.platform,
    env: process.env,
    exists: existsSync,
    readText: (file) => readFileSync(file, "utf8"),
    nodePath: process.execPath,
  };
}

const OWNER_ONLY_SCRIPT = 'umask 077; exec agent-browser "$@"';

/**
 * Resolve `agent-browser.cmd` on PATH to the program it runs. npm writes either
 * `"%~dp0node_modules\…\agent-browser-win32-x64.exe" %*` (native binary) or a
 * `"%dp0%\…\agent-browser.js"` entry (run with node).
 */
export function resolveWindowsAgentBrowser(
  ctx: AgentBrowserContext,
): { command: string; prefixArgs: string[] } | undefined {
  const pathValue = ctx.env.PATH ?? ctx.env.Path ?? "";
  for (const dir of pathValue.split(";").filter(Boolean)) {
    const shim = path.win32.join(dir, "agent-browser.cmd");
    if (!ctx.exists(shim)) continue;
    let text: string;
    try {
      text = ctx.readText(shim);
    } catch {
      continue;
    }
    const refs = [...text.matchAll(/"%(?:~dp0|dp0%)\\?([^"%]+\.(?:exe|c?js|mjs))"/gi)];
    const relative = refs.at(-1)?.[1];
    if (!relative) continue;
    const target = path.win32.join(dir, relative);
    if (!ctx.exists(target)) continue;
    return /\.exe$/i.test(target)
      ? { command: target, prefixArgs: [] }
      : { command: ctx.nodePath, prefixArgs: [target] };
  }
  return undefined;
}

/**
 * `[command, args]` for a shell-free spawn of one agent-browser invocation.
 * `ownerOnlyFiles` keeps the POSIX `umask 077` launch; on Windows it has no
 * POSIX meaning, so the resolved program runs directly.
 */
export function agentBrowserCommand(
  args: string[],
  options: { ownerOnlyFiles?: boolean } = {},
  ctx: AgentBrowserContext = defaultAgentBrowserContext(),
): [string, string[]] {
  if (ctx.platform === "win32") {
    const resolved = resolveWindowsAgentBrowser(ctx);
    if (resolved) return [resolved.command, [...resolved.prefixArgs, ...args]];
    return ["agent-browser", args];
  }
  return options.ownerOnlyFiles
    ? ["sh", ["-c", OWNER_ONLY_SCRIPT, "sh", ...args]]
    : ["agent-browser", args];
}
