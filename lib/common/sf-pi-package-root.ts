/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolve the sf-pi package root for runtime asset lookups.
 *
 * Prefer Pi's package manager for configured package sources so npm/git/local
 * install semantics stay owned by Pi. Fall back to a bounded module-relative
 * walk for development and explicit `-e` runs where sf-pi may not be present in
 * settings yet.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DefaultPackageManager,
  SettingsManager,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { findPackageInSettings } from "./sf-pi-package-state.ts";

export interface SfPiPackageRootResolution {
  packageRoot?: string;
  source: "pi-package-manager" | "module-walk" | "missing";
}

export function resolveSfPiPackageRoot(
  options: {
    cwd?: string;
    from?: string;
  } = {},
): SfPiPackageRootResolution {
  const cwd = options.cwd ?? process.cwd();
  const configured = resolveConfiguredPackageRoot(cwd);
  if (configured) {
    return { packageRoot: configured, source: "pi-package-manager" };
  }

  const walked = resolvePackageRootFromModule(options.from ?? import.meta.url);
  if (walked) {
    return { packageRoot: walked, source: "module-walk" };
  }

  return { source: "missing" };
}

export function resolveSfPiPackageRootPath(
  options: { cwd?: string; from?: string } = {},
): string | undefined {
  return resolveSfPiPackageRoot(options).packageRoot;
}

function resolveConfiguredPackageRoot(cwd: string): string | undefined {
  const projectMatch = findPackageInSettings(cwd, "project");
  const globalMatch = findPackageInSettings(cwd, "global");
  const match = projectMatch ?? globalMatch;
  if (!match) return undefined;

  try {
    const agentDir = getAgentDir();
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const packageManager = new DefaultPackageManager({ cwd, agentDir, settingsManager });
    const scope = match === projectMatch ? "project" : "user";
    return packageManager.getInstalledPath(match.source, scope);
  } catch {
    return undefined;
  }
}

function resolvePackageRootFromModule(from: string): string | undefined {
  try {
    let current = path.dirname(fileURLToPath(from));
    for (let i = 0; i < 10; i += 1) {
      if (
        existsSync(path.join(current, "package.json")) &&
        existsSync(path.join(current, "catalog"))
      ) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  } catch {
    // Fall through to undefined.
  }
  return undefined;
}
