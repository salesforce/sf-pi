/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared adapter from Pi's `pi.exec()` to the `ExecFn` type used by
 * sf-environment detection.
 *
 * Pi's exec returns `{ stdout, stderr, code, killed }` while the detection
 * layer expects `{ stdout, stderr, code }`. This adapter bridges the gap
 * so each extension doesn't need its own wrapper.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExecFn } from "./sf-environment/detect.ts";

/**
 * Build an ExecFn from a Pi extension API handle.
 *
 * Usage:
 * ```ts
 * const exec = buildExecFn(pi);
 * const env = await detectEnvironment(exec, ctx.cwd);
 * ```
 */
export function buildExecFn(pi: ExtensionAPI): ExecFn {
  return async (command, args, options) => {
    const result = await pi.exec(command, args, { timeout: options?.timeout });
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  };
}
