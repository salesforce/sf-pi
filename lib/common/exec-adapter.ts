/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared adapter from Pi's `pi.exec()` to the `ExecFn` type used by
 * sf-environment detection.
 *
 * Pi's exec returns `{ stdout, stderr, code, killed }` while the detection
 * layer expects `{ stdout, stderr, code }`. This adapter bridges the gap
 * so each extension doesn't need its own wrapper.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExecFn } from "./sf-environment/detect.ts";
import { spawnCommand } from "./windows-spawn.ts";

/**
 * Build an ExecFn from a Pi extension API handle.
 *
 * Forwards `timeout` and (optionally) `cwd` from the caller's options to
 * `pi.exec`. Pass a `defaultCwd` to anchor every call at a stable directory
 * (e.g. the extension command context's `ctx.cwd`); per-call `options.cwd`
 * still wins.
 *
 * Usage:
 * ```ts
 * const exec = buildExecFn(pi);                  // no default cwd
 * const exec = buildExecFn(pi, ctx.cwd);         // anchor every call to ctx.cwd
 * const env = await detectEnvironment(exec, ctx.cwd);
 * ```
 */
export function buildExecFn(pi: ExtensionAPI, defaultCwd?: string): ExecFn {
  return async (command, args, options) => {
    // Windows: run `.cmd` wrappers (sf, npm, agent-browser, …) without a shell.
    // Unchanged on macOS and Linux.
    const [file, fileArgs] = spawnCommand(command, args);
    const result = await pi.exec(file, fileArgs, {
      timeout: options?.timeout,
      cwd: options?.cwd ?? defaultCwd,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  };
}
