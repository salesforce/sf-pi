/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-pi extension health for the welcome screen.
 *
 * Source of truth:
 * - extension metadata comes from catalog/registry.ts
 * - enabled/disabled state comes from Pi package filters in settings.json
 *
 * This replaces the earlier hardcoded extension list so the welcome screen
 * stays in sync as new bundled extensions are added.
 */
import { existsSync, readFileSync } from "node:fs";
import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import { globalSettingsPath, projectSettingsPath } from "../../../lib/common/pi-paths.ts";
import type { ExtensionHealthItem } from "./types.ts";

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "sf-llm-gateway-internal": "LLM Gateway",
  "sf-pi-manager": "Pi Manager",
};

export function discoverExtensionHealth(cwd: string): ExtensionHealthItem[] {
  const disabledFiles = getDisabledExtensionsForCwd(cwd);

  return SF_PI_REGISTRY.map((extension) => {
    const name = DISPLAY_NAME_OVERRIDES[extension.id] ?? extension.name.replace(/^SF\s+/i, "");

    if (extension.alwaysActive) {
      return { name, status: "locked", icon: "◆" };
    }

    const isDisabled = disabledFiles.has(extension.file);
    return {
      name,
      status: isDisabled ? "disabled" : "active",
      icon: isDisabled ? "○" : "●",
    };
  });
}

/**
 * Mirror Pi's precedence rules: if the project settings contain an sf-pi entry,
 * that filter wins. Otherwise we fall back to the global package entry.
 */
function getDisabledExtensionsForCwd(cwd: string): Set<string> {
  const projectDisabled = getDisabledExtensions(projectSettingsPath(cwd));
  if (projectDisabled) {
    return projectDisabled;
  }

  return getDisabledExtensions(globalSettingsPath()) ?? new Set<string>();
}

function getDisabledExtensions(settingsPath: string): Set<string> | null {
  if (!existsSync(settingsPath)) return null;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as {
      packages?: Array<string | { source?: string; extensions?: unknown[] }>;
    };
    const packages = Array.isArray(settings.packages) ? settings.packages : [];

    for (const pkg of packages) {
      if (!pkg || typeof pkg !== "object") continue;
      const source = typeof pkg.source === "string" ? pkg.source : "";
      if (!isSfPiSource(source)) continue;

      const extensions = Array.isArray(pkg.extensions) ? pkg.extensions : [];
      const disabled = new Set<string>();
      for (const pattern of extensions) {
        if (typeof pattern === "string" && pattern.startsWith("!")) {
          disabled.add(pattern.slice(1));
        }
      }
      return disabled;
    }
  } catch {
    return null;
  }

  return null;
}

function isSfPiSource(source: string): boolean {
  const normalized = source.toLowerCase();
  return normalized.includes("sf-pi") || normalized.includes("jag-pi-extensions");
}
