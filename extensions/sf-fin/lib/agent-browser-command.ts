/* SPDX-License-Identifier: Apache-2.0 */
/**
 * How SF Fin starts agent-browser.
 *
 * macOS and Linux: `agent-browser` by name, or through `sh -c 'umask 077; …'`
 * for a launch that will hold a Fin login, so its files are created owner-only.
 * Arguments pass through "$@", never into the shell string.
 *
 * Windows: `umask` has no meaning on NTFS and `sh` is only present when Git Bash
 * is on PATH, so every launch runs the program behind npm's `agent-browser.cmd`
 * directly (see lib/common/windows-spawn.ts). Access to those files follows the
 * user profile's inherited ACLs.
 */
import {
  defaultWindowsSpawnContext,
  spawnCommand,
  type WindowsSpawnContext,
} from "../../../lib/common/windows-spawn.ts";

const OWNER_ONLY_SCRIPT = 'umask 077; exec agent-browser "$@"';

/** `[command, args]` for a shell-free spawn of one agent-browser invocation. */
export function agentBrowserCommand(
  args: string[],
  options: { ownerOnlyFiles?: boolean } = {},
  ctx: WindowsSpawnContext = defaultWindowsSpawnContext(),
): [string, string[]] {
  if (ctx.platform === "win32") return spawnCommand("agent-browser", args, ctx);
  return options.ownerOnlyFiles
    ? ["sh", ["-c", OWNER_ONLY_SCRIPT, "sh", ...args]]
    : ["agent-browser", args];
}
