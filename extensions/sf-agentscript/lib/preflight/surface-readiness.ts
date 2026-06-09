/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Org surface readiness checks for Agent Script features that compile locally
 * but depend on target-org channel/runtime setup.
 *
 * These checks are intentionally read-only and conservative. They surface
 * likely preview/publish/runtime blockers; they never attempt setup and they
 * never encode UI-only workarounds.
 */

import type { Connection } from "@salesforce/core";
import type { AgentFeatureProfile } from "../feature-profile.ts";
import {
  channelLabel,
  needsMessagingReadiness,
  needsVoiceReadiness,
  queryChannels,
  queryOptional,
  type ChannelRecord,
} from "./surface/common.ts";
import { checkPlannerReadiness } from "./surface/planner.ts";
import { checkQueueReadiness } from "./surface/queue.ts";
import { checkRoutingFlowReadiness } from "./surface/routing-flow.ts";
import type { SurfaceReadinessCheck } from "./surface/types.ts";

export type { SurfaceReadinessCheck, SurfaceReadinessStatus } from "./surface/types.ts";

interface ServiceChannelRecord {
  Id?: string;
  DeveloperName?: string;
  MasterLabel?: string;
  RelatedEntity?: string;
}

export interface SurfaceReadinessContext {
  agentApiName?: string;
}

export async function checkSurfaceReadiness(
  conn: Connection,
  profile: AgentFeatureProfile,
  context: SurfaceReadinessContext = {},
): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  if (needsVoiceReadiness(profile)) {
    checks.push(...(await checkVoiceReadiness(conn)));
  }
  if (needsMessagingReadiness(profile)) {
    checks.push(...(await checkMessagingReadiness(conn)));
  }
  checks.push(...(await checkPlannerReadiness(conn, profile, context)));
  checks.push(...(await checkRoutingFlowReadiness(conn, profile)));
  checks.push(...(await checkQueueReadiness(conn, profile)));
  checks.push(...channelConnectionGapChecks(profile));
  return checks;
}

function channelConnectionGapChecks(profile: AgentFeatureProfile): SurfaceReadinessCheck[] {
  const surfaces: string[] = [];
  if (needsVoiceReadiness(profile)) surfaces.push("voice");
  if (needsMessagingReadiness(profile)) surfaces.push("messaging");
  if (surfaces.length === 0) return [];
  return [
    {
      code: "agent-channel-connection-manual-verification",
      surface: surfaces.includes("voice") ? "voice" : "messaging",
      status: "warning",
      message:
        "Agent-to-channel connection readiness cannot be fully verified through the Agent Script compiler. Confirm the published agent is connected to the intended channel surface before end-to-end testing.",
      evidence: [`surfaces: ${surfaces.join(", ")}`],
    },
  ];
}

async function checkVoiceReadiness(conn: Connection): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  const voiceChannels = await queryChannels(conn, "MessageType = 'PstnVoice'", 5);
  if (voiceChannels === null) {
    checks.push({
      code: "voice-messaging-channel-unverifiable",
      surface: "voice",
      status: "unverifiable",
      message:
        "Could not verify PstnVoice MessagingChannel readiness in the target org. Voice Agent Script can compile while channel setup is still incomplete.",
    });
  } else if (voiceChannels.length === 0) {
    checks.push({
      code: "voice-messaging-channel-missing",
      surface: "voice",
      status: "warning",
      message:
        "No PstnVoice MessagingChannel was found in the target org. Voice-linked Agent Script may compile, but inbound voice routing is likely not configured.",
    });
  } else {
    const inactive = voiceChannels.filter((channel) => channel.IsActive === false);
    checks.push({
      code: "voice-messaging-channel-found",
      surface: "voice",
      status: inactive.length > 0 ? "warning" : "ok",
      message:
        inactive.length > 0
          ? "PstnVoice MessagingChannel records exist, but at least one appears inactive. Confirm the channel is activated before end-to-end voice testing."
          : "PstnVoice MessagingChannel records exist in the target org.",
      evidence: voiceChannels.map(formatVoiceChannelEvidence),
    });
    const missingRouting = voiceChannels.filter(
      (channel) => !channel.SessionHandlerId && !channel.FallbackQueueId,
    );
    if (missingRouting.length > 0) {
      checks.push({
        code: "voice-channel-routing-incomplete",
        surface: "voice",
        status: "warning",
        message:
          "At least one PstnVoice MessagingChannel has no SessionHandlerId or FallbackQueueId. Voice calls may not route to an agent or queue.",
        evidence: missingRouting.map(formatVoiceChannelEvidence),
      });
    }
  }

  const serviceChannels = await queryOptional<ServiceChannelRecord>(
    conn,
    "SELECT Id, DeveloperName, MasterLabel, RelatedEntity FROM ServiceChannel WHERE RelatedEntity = 'VoiceCall' OR DeveloperName = 'sfdc_phone' LIMIT 5",
  );
  if (serviceChannels === null) {
    checks.push({
      code: "voice-service-channel-unverifiable",
      surface: "voice",
      status: "unverifiable",
      message: "Could not verify ServiceChannel readiness for VoiceCall in the target org.",
    });
  } else if (serviceChannels.length === 0) {
    checks.push({
      code: "voice-service-channel-missing",
      surface: "voice",
      status: "warning",
      message:
        "No ServiceChannel for VoiceCall was found. Voice escalation or queue routing may be incomplete even when Agent Script compilation succeeds.",
    });
  } else {
    checks.push({
      code: "voice-service-channel-found",
      surface: "voice",
      status: "ok",
      message: "A VoiceCall ServiceChannel is present in the target org.",
      evidence: serviceChannels.map(formatServiceChannelEvidence),
    });
  }

  return checks;
}

async function checkMessagingReadiness(conn: Connection): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  const channels = await queryChannels(conn, "MessageType != 'PstnVoice'", 10);
  if (channels === null) {
    checks.push({
      code: "messaging-channel-unverifiable",
      surface: "messaging",
      status: "unverifiable",
      message:
        "Could not verify MessagingChannel readiness in the target org. Messaging Agent Script can compile while channel setup is still incomplete.",
    });
  } else if (channels.length === 0) {
    checks.push({
      code: "messaging-channel-missing",
      surface: "messaging",
      status: "warning",
      message:
        "No non-voice MessagingChannel records were found in the target org. Messaging-linked Agent Script may compile, but digital-channel routing is likely not configured.",
    });
  } else {
    const inactive = channels.filter((channel) => channel.IsActive === false);
    checks.push({
      code: "messaging-channel-found",
      surface: "messaging",
      status: inactive.length > 0 ? "warning" : "ok",
      message:
        inactive.length > 0
          ? "MessagingChannel records exist, but at least one appears inactive. Confirm channel activation before end-to-end messaging tests."
          : "MessagingChannel records exist in the target org.",
      evidence: channels.map(formatMessagingChannelEvidence),
    });
    const missingRouting = channels.filter(
      (channel) => !channel.SessionHandlerId && !channel.FallbackQueueId,
    );
    if (missingRouting.length > 0) {
      checks.push({
        code: "messaging-channel-routing-incomplete",
        surface: "messaging",
        status: "warning",
        message:
          "At least one MessagingChannel has no SessionHandlerId or FallbackQueueId. Conversations may not route to an agent or queue.",
        evidence: missingRouting.map(formatMessagingChannelEvidence),
      });
    }
  }

  const serviceChannels = await queryOptional<ServiceChannelRecord>(
    conn,
    "SELECT Id, DeveloperName, MasterLabel, RelatedEntity FROM ServiceChannel WHERE RelatedEntity = 'MessagingSession' OR DeveloperName = 'sfdc_livemessage' LIMIT 5",
  );
  if (serviceChannels === null) {
    checks.push({
      code: "messaging-service-channel-unverifiable",
      surface: "messaging",
      status: "unverifiable",
      message: "Could not verify ServiceChannel readiness for MessagingSession in the target org.",
    });
  } else if (serviceChannels.length === 0) {
    checks.push({
      code: "messaging-service-channel-missing",
      surface: "messaging",
      status: "warning",
      message:
        "No ServiceChannel for MessagingSession was found. Messaging escalation or queue routing may be incomplete even when Agent Script compilation succeeds.",
    });
  } else {
    checks.push({
      code: "messaging-service-channel-found",
      surface: "messaging",
      status: "ok",
      message: "A MessagingSession ServiceChannel is present in the target org.",
      evidence: serviceChannels.map(formatServiceChannelEvidence),
    });
  }

  return checks;
}

function formatVoiceChannelEvidence(channel: ChannelRecord): string {
  const label = channelLabel(channel);
  const flags = [
    channel.IsActive === false ? "inactive" : null,
    channel.SessionHandlerId ? "session handler set" : null,
    channel.FallbackQueueId ? "fallback queue set" : null,
  ].filter(Boolean);
  return `${label}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`;
}

function formatMessagingChannelEvidence(channel: ChannelRecord): string {
  const label = channelLabel(channel);
  const flags = [
    channel.MessageType ? `type=${channel.MessageType}` : null,
    channel.IsActive === false ? "inactive" : null,
    channel.SessionHandlerId ? "session handler set" : null,
    channel.FallbackQueueId ? "fallback queue set" : null,
  ].filter(Boolean);
  return `${label}${flags.length > 0 ? ` (${flags.join(", ")})` : ""}`;
}

function formatServiceChannelEvidence(channel: ServiceChannelRecord): string {
  const label = channel.DeveloperName ?? channel.MasterLabel ?? channel.Id ?? "ServiceChannel";
  return `${label}${channel.RelatedEntity ? ` (${channel.RelatedEntity})` : ""}`;
}
