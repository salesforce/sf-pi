/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import type { Connection } from "@salesforce/core";
import { checkPhoneReadiness } from "../lib/preflight/surface/phone.ts";
import { checkAgentforceSettingsReadiness } from "../lib/preflight/surface/settings.ts";
import type { AgentFeatureProfile } from "../lib/feature-profile.ts";

function voiceProfile(): AgentFeatureProfile {
  return {
    linked_variables: [],
    mutable_variables: [],
    context_variables_template: [],
    modalities: ["voice"],
    response_formats: [],
    connection_names: [],
    utility_refs: [],
    publish_risks: [],
  };
}

function connWith(results: Record<string, unknown[]>, settings?: unknown): Connection {
  return {
    query: async (soql: string) => {
      for (const [needle, records] of Object.entries(results)) {
        if (soql.includes(needle)) return { records };
      }
      throw new Error(`Unexpected query: ${soql}`);
    },
    metadata: {
      read: async () => settings,
    },
  } as unknown as Connection;
}

describe("phone/settings readiness", () => {
  test("warns when no Live phone number is available", async () => {
    const checks = await checkPhoneReadiness(
      connWith({ PhoneNumber: [{ Code: "+15551234567", CodeStatus: "Pending" }] }),
      voiceProfile(),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-phone-number-not-live:warning",
    ]);
  });

  test("returns ok when a Live phone number exists", async () => {
    const checks = await checkPhoneReadiness(
      connWith({ PhoneNumber: [{ Code: "+15551234567", CodeStatus: "Live" }] }),
      voiceProfile(),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-phone-number-live:ok",
    ]);
  });

  test("warns when Agentforce settings are incomplete", async () => {
    const checks = await checkAgentforceSettingsReadiness(
      connWith({}, { enableEinsteinGptPlatform: true }),
      voiceProfile(),
    );
    expect(checks).toEqual([
      {
        code: "agentforce-settings-incomplete",
        surface: "voice",
        status: "warning",
        message:
          "Agentforce platform settings appear incomplete. Metadata deploy, publish, or channel runtime may fail until the platform settings are enabled.",
        evidence: [
          "enableEinsteinGPTDeployPromptTemplatesAsActive",
          "enableEinsteinGptAllowUnsafePTInputChanges",
          "enableEinsteinGptGlobalLangSupport",
        ],
      },
    ]);
  });

  test("returns ok when Agentforce settings are enabled", async () => {
    const checks = await checkAgentforceSettingsReadiness(
      connWith(
        {},
        {
          enableEinsteinGptPlatform: true,
          enableEinsteinGPTDeployPromptTemplatesAsActive: true,
          enableEinsteinGptAllowUnsafePTInputChanges: true,
          enableEinsteinGptGlobalLangSupport: true,
        },
      ),
      voiceProfile(),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "agentforce-settings-ready:ok",
    ]);
  });
});
