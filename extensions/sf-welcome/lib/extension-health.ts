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
import { SF_PI_REGISTRY } from "../../../catalog/registry.ts";
import { getDisabledExtensionFilesForCwd } from "../../../lib/common/sf-pi-extension-state.ts";
import type { ExtensionHealthItem } from "./types.ts";

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
  "sf-llm-gateway-internal": "LLM Gateway",
  "sf-pi-manager": "Pi Manager",
};

export function discoverExtensionHealth(cwd: string): ExtensionHealthItem[] {
  const disabledFiles = getDisabledExtensionFilesForCwd(cwd);

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
