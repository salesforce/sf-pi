/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import type { Connection } from "@salesforce/core";
import { checkPlannerReadiness } from "../lib/preflight/surface/planner.ts";
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

function connWith(input: {
  botRecords?: unknown[];
  flowRecords?: unknown[];
  plannerMetadata?: unknown;
  metadataThrows?: boolean;
}): Connection {
  return {
    query: async (soql: string) => {
      if (soql.includes("FROM BotDefinition")) return { records: input.botRecords ?? [] };
      if (soql.includes("FROM FlowDefinitionView")) return { records: input.flowRecords ?? [] };
      throw new Error(`Unexpected query: ${soql}`);
    },
    metadata: {
      read: async () => {
        if (input.metadataThrows) throw new Error("metadata unavailable");
        return input.plannerMetadata;
      },
    },
  } as unknown as Connection;
}

describe("checkPlannerReadiness", () => {
  test("skips planner checks for brand-new local agents with no BotDefinition", async () => {
    const checks = await checkPlannerReadiness(connWith({ botRecords: [] }), voiceProfile(), {
      agentApiName: "Support_Agent",
    });
    expect(checks).toEqual([]);
  });

  test("warns when an existing voice planner is not telephony-ready", async () => {
    const checks = await checkPlannerReadiness(
      connWith({
        botRecords: [{ Id: "0XxBot", DeveloperName: "Support_Agent" }],
        plannerMetadata: {
          plannerType: "Atlas__ConcurrentMultiAgentOrchestration",
          plannerSurfaces: [{ surfaceType: "Messaging" }],
        },
      }),
      voiceProfile(),
      { agentApiName: "Support_Agent" },
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-planner-type-review:warning",
      "voice-planner-telephony-surface-missing:warning",
      "voice-planner-topics-missing:warning",
    ]);
  });

  test("blocks when a telephony outbound route references a missing active RoutingFlow", async () => {
    const checks = await checkPlannerReadiness(
      connWith({
        botRecords: [{ Id: "0XxBot", DeveloperName: "Support_Agent" }],
        flowRecords: [],
        plannerMetadata: {
          plannerType: "Atlas__VoiceAgent",
          plannerSurfaces: [
            {
              surface: "SurfaceAction__Telephony",
              outboundRouteConfigs: {
                outboundRouteName: "Support_Agent_Escalation",
                outboundRouteType: "OmniChannelFlow",
              },
            },
          ],
          localTopicLinks: [{ genAiPluginName: "Escalation" }],
        },
      }),
      voiceProfile(),
      { agentApiName: "Support_Agent" },
    );
    expect(checks).toEqual([
      {
        code: "voice-planner-outbound-route-flow-missing",
        surface: "voice",
        status: "blocker",
        message:
          "Published voice agent planner references an outbound route flow that does not resolve to an active RoutingFlow in the target org.",
        evidence: ["outboundRouteName: Support_Agent_Escalation"],
      },
    ]);
  });

  test("returns no findings when published voice planner metadata is ready", async () => {
    const checks = await checkPlannerReadiness(
      connWith({
        botRecords: [{ Id: "0XxBot", DeveloperName: "Support_Agent" }],
        flowRecords: [{ ApiName: "Support_Agent_Escalation", ProcessType: "RoutingFlow" }],
        plannerMetadata: {
          plannerType: "Atlas__VoiceAgent",
          plannerSurfaces: [
            {
              surfaceType: "Telephony",
              outboundRouteConfigs: [
                {
                  outboundRouteName: "Support_Agent_Escalation",
                  outboundRouteType: "OmniChannelFlow",
                },
              ],
            },
          ],
          localTopics: [{ developerName: "Escalation" }],
        },
      }),
      voiceProfile(),
      { agentApiName: "Support_Agent" },
    );
    expect(checks).toEqual([]);
  });

  test("marks planner metadata as unverifiable when metadata read is unavailable", async () => {
    const checks = await checkPlannerReadiness(
      connWith({
        botRecords: [{ Id: "0XxBot", DeveloperName: "Support_Agent" }],
        metadataThrows: true,
      }),
      voiceProfile(),
      { agentApiName: "Support_Agent" },
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-planner-metadata-unverifiable:unverifiable",
    ]);
  });
});
