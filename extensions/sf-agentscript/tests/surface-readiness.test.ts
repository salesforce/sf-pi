/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import type { Connection } from "@salesforce/core";
import { checkSurfaceReadiness } from "../lib/preflight/surface-readiness.ts";
import type { AgentFeatureProfile } from "../lib/feature-profile.ts";

function profile(overrides: Partial<AgentFeatureProfile> = {}): AgentFeatureProfile {
  return {
    linked_variables: [],
    mutable_variables: [],
    context_variables_template: [],
    modalities: [],
    response_formats: [],
    connection_names: [],
    utility_refs: [],
    publish_risks: [],
    ...overrides,
  };
}

function connWith(results: Record<string, unknown[]>): Connection {
  return {
    query: async (soql: string) => {
      for (const [needle, records] of Object.entries(results)) {
        if (soql.includes(needle)) return { records };
      }
      throw new Error(`Unexpected query: ${soql}`);
    },
  } as unknown as Connection;
}

describe("checkSurfaceReadiness", () => {
  test("skips org checks when the agent has no voice signals", async () => {
    const checks = await checkSurfaceReadiness(connWith({}), profile());
    expect(checks).toEqual([]);
  });

  test("warns when voice agent metadata has no voice channel records", async () => {
    const checks = await checkSurfaceReadiness(
      connWith({ MessagingChannel: [], ServiceChannel: [] }),
      profile({ modalities: ["voice"] }),
    );
    expect(checks.map((check) => check.code)).toEqual([
      "voice-messaging-channel-missing",
      "voice-service-channel-missing",
      "agent-channel-connection-manual-verification",
    ]);
    expect(checks.every((check) => check.status === "warning")).toBe(true);
  });

  test("warns when a voice channel exists without routing fields", async () => {
    const checks = await checkSurfaceReadiness(
      connWith({
        MessagingChannel: [{ DeveloperName: "SupportVoice", MessageType: "PstnVoice" }],
        ServiceChannel: [{ DeveloperName: "sfdc_phone", RelatedEntity: "VoiceCall" }],
      }),
      profile({
        linked_variables: [{ name: "VoiceCallId", source_namespace: "VoiceCall" }],
      }),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-messaging-channel-found:ok",
      "voice-channel-routing-incomplete:warning",
      "voice-service-channel-found:ok",
      "agent-channel-connection-manual-verification:warning",
    ]);
  });

  test("marks channel probes unverifiable when org queries fail", async () => {
    const checks = await checkSurfaceReadiness(
      {
        query: async () => {
          throw new Error("no access");
        },
      } as unknown as Connection,
      profile({ modalities: ["voice"] }),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-messaging-channel-unverifiable:unverifiable",
      "voice-service-channel-unverifiable:unverifiable",
      "agent-channel-connection-manual-verification:warning",
    ]);
  });

  test("warns when messaging metadata has no digital channel records", async () => {
    const checks = await checkSurfaceReadiness(
      connWith({
        "MessageType != 'PstnVoice'": [],
        "RelatedEntity = 'MessagingSession'": [],
      }),
      profile({ connection_names: ["messaging"] }),
    );
    expect(checks.map((check) => check.code)).toEqual([
      "messaging-channel-missing",
      "messaging-service-channel-missing",
      "agent-channel-connection-manual-verification",
    ]);
  });

  test("warns when a messaging channel exists without routing fields", async () => {
    const checks = await checkSurfaceReadiness(
      connWith({
        "MessageType != 'PstnVoice'": [
          { DeveloperName: "WebChat", MessageType: "EmbeddedMessaging" },
        ],
        "RelatedEntity = 'MessagingSession'": [
          { DeveloperName: "sfdc_livemessage", RelatedEntity: "MessagingSession" },
        ],
      }),
      profile({
        linked_variables: [{ name: "MessagingSessionId", source_namespace: "MessagingSession" }],
      }),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "messaging-channel-found:ok",
      "messaging-channel-routing-incomplete:warning",
      "messaging-service-channel-found:ok",
      "agent-channel-connection-manual-verification:warning",
    ]);
  });
});
