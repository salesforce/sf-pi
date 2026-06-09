/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only routing-flow checks for channel SessionHandlerId wiring. */

import type { Connection } from "@salesforce/core";
import type { AgentFeatureProfile } from "../../feature-profile.ts";
import {
  channelLabel,
  needsMessagingReadiness,
  needsVoiceReadiness,
  queryChannels,
  queryOptional,
  soqlEscape,
  type ChannelRecord,
} from "./common.ts";
import type { SurfaceReadinessCheck } from "./types.ts";

interface FlowDefinitionViewRow {
  Id?: string;
  ApiName?: string;
  ProcessType?: string;
}

export async function checkRoutingFlowReadiness(
  conn: Connection,
  profile: AgentFeatureProfile,
): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  if (needsVoiceReadiness(profile)) {
    const channels = await queryChannels(conn, "MessageType = 'PstnVoice'", 5);
    if (channels) checks.push(...(await checkChannels(conn, "voice", channels)));
  }
  if (needsMessagingReadiness(profile)) {
    const channels = await queryChannels(conn, "MessageType != 'PstnVoice'", 10);
    if (channels) checks.push(...(await checkChannels(conn, "messaging", channels)));
  }
  return checks;
}

async function checkChannels(
  conn: Connection,
  surface: "voice" | "messaging",
  channels: ChannelRecord[],
): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  for (const channel of channels) {
    const handlerId = channel.SessionHandlerId;
    if (!handlerId) continue;
    const label = channelLabel(channel);
    if (!handlerId.startsWith("300")) {
      checks.push({
        code: `${surface}-routing-session-handler-id-review`,
        surface,
        status: "warning",
        message:
          "Channel SessionHandlerId is present but does not look like a FlowDefinition id. Confirm the channel points at the FlowDefinition, not a flow version or unrelated record.",
        evidence: [`${label}: ${handlerId}`],
      });
    }
    const flow = await findFlowDefinitionById(conn, handlerId);
    if (flow === null) {
      checks.push({
        code: `${surface}-routing-flow-unverifiable`,
        surface,
        status: "unverifiable",
        message:
          "Could not verify the channel SessionHandlerId against active FlowDefinition records.",
        evidence: [`${label}: ${handlerId}`],
      });
    } else if (!flow) {
      checks.push({
        code: `${surface}-routing-flow-missing`,
        surface,
        status: "warning",
        message:
          "Channel SessionHandlerId does not resolve to an active FlowDefinition. Conversations may not route correctly.",
        evidence: [`${label}: ${handlerId}`],
      });
    } else if (flow.ProcessType && flow.ProcessType !== "RoutingFlow") {
      checks.push({
        code: `${surface}-routing-flow-type-review`,
        surface,
        status: "warning",
        message:
          "Channel SessionHandlerId resolves to an active flow, but it is not reported as a RoutingFlow. Confirm this flow is valid for channel routing.",
        evidence: [`${label}: ${flow.ApiName ?? handlerId} (${flow.ProcessType})`],
      });
    }
  }
  return checks;
}

async function findFlowDefinitionById(
  conn: Connection,
  id: string,
): Promise<FlowDefinitionViewRow | undefined | null> {
  const rows = await queryOptional<FlowDefinitionViewRow>(
    conn,
    `SELECT Id, ApiName, ProcessType FROM FlowDefinitionView WHERE Id='${soqlEscape(id)}' AND IsActive = true LIMIT 1`,
  );
  if (rows === null) return null;
  return rows[0];
}
