/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import type { Connection } from "@salesforce/core";
import { checkRoutingFlowReadiness } from "../lib/preflight/surface/routing-flow.ts";
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

describe("checkRoutingFlowReadiness", () => {
  test("warns when channel SessionHandlerId does not look like FlowDefinition", async () => {
    const checks = await checkRoutingFlowReadiness(
      connWith({
        "MessageType = 'PstnVoice'": [
          { DeveloperName: "VoiceChannel", MessageType: "PstnVoice", SessionHandlerId: "301xx" },
        ],
        FlowDefinitionView: [],
      }),
      voiceProfile(),
    );
    expect(checks.map((check) => `${check.code}:${check.status}`)).toEqual([
      "voice-routing-session-handler-id-review:warning",
      "voice-routing-flow-missing:warning",
    ]);
  });

  test("warns when SessionHandlerId resolves to a non-routing flow", async () => {
    const checks = await checkRoutingFlowReadiness(
      connWith({
        "MessageType = 'PstnVoice'": [
          { DeveloperName: "VoiceChannel", MessageType: "PstnVoice", SessionHandlerId: "300xx" },
        ],
        FlowDefinitionView: [{ Id: "300xx", ApiName: "Inbound", ProcessType: "Flow" }],
      }),
      voiceProfile(),
    );
    expect(checks).toEqual([
      {
        code: "voice-routing-flow-type-review",
        surface: "voice",
        status: "warning",
        message:
          "Channel SessionHandlerId resolves to an active flow, but it is not reported as a RoutingFlow. Confirm this flow is valid for channel routing.",
        evidence: ["VoiceChannel: Inbound (Flow)"],
      },
    ]);
  });

  test("returns no findings when SessionHandlerId resolves to active RoutingFlow", async () => {
    const checks = await checkRoutingFlowReadiness(
      connWith({
        "MessageType = 'PstnVoice'": [
          { DeveloperName: "VoiceChannel", MessageType: "PstnVoice", SessionHandlerId: "300xx" },
        ],
        FlowDefinitionView: [{ Id: "300xx", ApiName: "Inbound", ProcessType: "RoutingFlow" }],
      }),
      voiceProfile(),
    );
    expect(checks).toEqual([]);
  });
});
