/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import type { Connection } from "@salesforce/core";
import { checkQueueReadiness } from "../lib/preflight/surface/queue.ts";
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

function messagingProfile(): AgentFeatureProfile {
  return { ...voiceProfile(), modalities: [], connection_names: ["messaging"] };
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

describe("checkQueueReadiness", () => {
  test("warns when a voice fallback queue lacks VoiceCall support, members, and routing config", async () => {
    const checks = await checkQueueReadiness(
      connWith({
        "MessageType = 'PstnVoice'": [
          { DeveloperName: "VoiceChannel", MessageType: "PstnVoice", FallbackQueueId: "00GQ" },
        ],
        "FROM Group WHERE": [{ Id: "00GQ", DeveloperName: "Voice_Queue" }],
        QueueSObject: [],
        GroupMember: [],
      }),
      voiceProfile(),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-queue-sobject-missing:warning",
      "voice-queue-members-missing:warning",
      "voice-queue-routing-config-missing:warning",
    ]);
  });

  test("warns when a channel fallback queue id does not resolve", async () => {
    const checks = await checkQueueReadiness(
      connWith({
        "MessageType = 'PstnVoice'": [
          { DeveloperName: "VoiceChannel", MessageType: "PstnVoice", FallbackQueueId: "00GQ" },
        ],
        "FROM Group WHERE": [],
      }),
      voiceProfile(),
    );
    expect(checks).toEqual([
      {
        code: "voice-fallback-queue-missing",
        surface: "voice",
        status: "warning",
        message:
          "Channel FallbackQueueId does not resolve to a queue. Escalation or fallback routing may fail.",
        evidence: ["VoiceChannel: 00GQ"],
      },
    ]);
  });

  test("returns no findings when voice fallback queue is ready", async () => {
    const checks = await checkQueueReadiness(
      connWith({
        "MessageType = 'PstnVoice'": [
          { DeveloperName: "VoiceChannel", MessageType: "PstnVoice", FallbackQueueId: "00GQ" },
        ],
        "FROM Group WHERE": [
          { Id: "00GQ", DeveloperName: "Voice_Queue", QueueRoutingConfigId: "0RC" },
        ],
        QueueSObject: [{ QueueId: "00GQ", SobjectType: "VoiceCall" }],
        GroupMember: [{ GroupId: "00GQ", UserOrGroupId: "005U" }],
        QueueRoutingConfig: [
          { Id: "0RC", DeveloperName: "Voice_RC", RoutingModel: "ExternalRouting" },
        ],
      }),
      voiceProfile(),
    );
    expect(checks).toEqual([]);
  });

  test("checks messaging queues for MessagingSession support", async () => {
    const checks = await checkQueueReadiness(
      connWith({
        "MessageType != 'PstnVoice'": [
          {
            DeveloperName: "WebChannel",
            MessageType: "EmbeddedMessaging",
            FallbackQueueId: "00GM",
          },
        ],
        "FROM Group WHERE": [
          { Id: "00GM", DeveloperName: "Messaging_Queue", QueueRoutingConfigId: "0RC" },
        ],
        QueueSObject: [],
        GroupMember: [{ GroupId: "00GM", UserOrGroupId: "005U" }],
        QueueRoutingConfig: [{ Id: "0RC", DeveloperName: "Messaging_RC" }],
      }),
      messagingProfile(),
    );
    expect(checks.map((check) => check.code)).toEqual(["messaging-queue-sobject-missing"]);
  });
});
