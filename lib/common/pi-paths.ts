/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pi path helpers shared by sf-pi extensions.
 *
 * Pi SDK consumers can override/rebrand the global agent directory. Keep runtime
 * path construction behind this tiny helper so extensions use Pi's getAgentDir()
 * for global files and centralize the project-local `.pi` convention in one
 * place instead of scattering path literals through implementation code.
 */
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import path from "node:path";

/** Project-local Pi config folder for the current public Pi package. */
export const PROJECT_CONFIG_DIR_NAME = ".pi";

/** Global Pi agent directory, e.g. `~/.pi/agent` for the normal Pi CLI. */
export function globalAgentDir(): string {
  return getAgentDir();
}

/** Path to a file or folder under the global Pi agent directory. */
export function globalAgentPath(...segments: string[]): string {
  return path.join(globalAgentDir(), ...segments);
}

/** Global Pi settings file. Honors Pi SDK agent-dir overrides. */
export function globalSettingsPath(): string {
  return globalAgentPath("settings.json");
}

/** Project-local Pi config directory, e.g. `<cwd>/.pi` for the normal Pi CLI. */
export function projectConfigDir(cwd: string): string {
  return path.join(cwd, PROJECT_CONFIG_DIR_NAME);
}

/** Path to a file or folder under the project-local Pi config directory. */
export function projectConfigPath(cwd: string, ...segments: string[]): string {
  return path.join(projectConfigDir(cwd), ...segments);
}

/** Project-local Pi settings file. */
export function projectSettingsPath(cwd: string): string {
  return projectConfigPath(cwd, "settings.json");
}
