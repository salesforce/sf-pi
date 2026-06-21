/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only Agentforce settings readiness checks. */

import type { Connection } from "@salesforce/core";
import { boundedPromise } from "../../bounded-salesforce-transport.ts";
import type { AgentFeatureProfile } from "../../feature-profile.ts";
import { needsMessagingReadiness, needsVoiceReadiness } from "./common.ts";
import type { SurfaceReadinessCheck } from "./types.ts";

interface EinsteinGptSettingsMetadata {
  enableEinsteinGptPlatform?: unknown;
  enableEinsteinGPTDeployPromptTemplatesAsActive?: unknown;
  enableEinsteinGptAllowUnsafePTInputChanges?: unknown;
  enableEinsteinGptGlobalLangSupport?: unknown;
}

export async function checkAgentforceSettingsReadiness(
  conn: Connection,
  profile: AgentFeatureProfile,
): Promise<SurfaceReadinessCheck[]> {
  if (!needsVoiceReadiness(profile) && !needsMessagingReadiness(profile)) return [];
  const settings = await readEinsteinGptSettings(conn);
  const surface = needsVoiceReadiness(profile) ? "voice" : "messaging";
  if (settings === null) {
    return [
      {
        code: "agentforce-settings-unverifiable",
        surface,
        status: "unverifiable",
        message:
          "Could not verify Agentforce platform settings. Publish or channel runtime can fail if Agentforce settings are not enabled in the org.",
      },
    ];
  }
  const missing = [
    ["enableEinsteinGptPlatform", settings.enableEinsteinGptPlatform],
    [
      "enableEinsteinGPTDeployPromptTemplatesAsActive",
      settings.enableEinsteinGPTDeployPromptTemplatesAsActive,
    ],
    [
      "enableEinsteinGptAllowUnsafePTInputChanges",
      settings.enableEinsteinGptAllowUnsafePTInputChanges,
    ],
    ["enableEinsteinGptGlobalLangSupport", settings.enableEinsteinGptGlobalLangSupport],
  ]
    .filter(([, value]) => value !== true && value !== "true")
    .map(([name]) => name as string);
  if (missing.length === 0) {
    return [
      {
        code: "agentforce-settings-ready",
        surface,
        status: "ok",
        message: "Agentforce platform settings appear enabled.",
      },
    ];
  }
  return [
    {
      code: "agentforce-settings-incomplete",
      surface,
      status: "warning",
      message:
        "Agentforce platform settings appear incomplete. Metadata deploy, publish, or channel runtime may fail until the platform settings are enabled.",
      evidence: missing,
    },
  ];
}

async function readEinsteinGptSettings(
  conn: Connection,
): Promise<EinsteinGptSettingsMetadata | null> {
  const metadata = (
    conn as { metadata?: { read?: (type: string, fullNames: string[]) => unknown } }
  ).metadata;
  if (!metadata?.read) return null;
  try {
    const raw = await boundedPromise(
      Promise.resolve(metadata.read("EinsteinGptSettings", ["EinsteinGpt"])),
      "EinsteinGptSettings metadata read",
    );
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || typeof value !== "object") return null;
    return value as EinsteinGptSettingsMetadata;
  } catch {
    return null;
  }
}
