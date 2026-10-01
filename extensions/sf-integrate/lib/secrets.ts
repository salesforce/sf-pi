/* SPDX-License-Identifier: Apache-2.0 */
/** Secret-source resolution that never accepts a raw secret tool argument. */

import type { SfIntegrateParams } from "./types.ts";

export async function resolveSecretInput(
  params: SfIntegrateParams,
  promptSecret: (signal?: AbortSignal) => Promise<string>,
  signal?: AbortSignal,
): Promise<string> {
  const source = params.secret_source ?? "prompt";
  if (source === "prompt") return promptSecret(signal);
  const name = params.secret_env?.trim() ?? "";
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) {
    throw new Error("secret_env must be an uppercase environment-variable name.");
  }
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is not set.`);
  return value;
}
