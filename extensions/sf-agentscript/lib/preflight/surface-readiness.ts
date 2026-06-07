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

export type SurfaceReadinessStatus = "ok" | "warning" | "unverifiable";

export interface SurfaceReadinessCheck {
  code: string;
  surface: "voice" | "messaging";
  status: SurfaceReadinessStatus;
  message: string;
  evidence?: string[];
}

interface QueryResult<T> {
  records?: T[];
}

interface VoiceMessagingChannelRecord {
  Id?: string;
  DeveloperName?: string;
  MasterLabel?: string;
  MessageType?: string;
  IsActive?: boolean;
  SessionHandlerId?: string | null;
  FallbackQueueId?: string | null;
}

interface ServiceChannelRecord {
  Id?: string;
  DeveloperName?: string;
  MasterLabel?: string;
  RelatedEntity?: string;
}

export async function checkSurfaceReadiness(
  conn: Connection,
  profile: AgentFeatureProfile,
): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  if (needsVoiceReadiness(profile)) {
    checks.push(...(await checkVoiceReadiness(conn)));
  }
  return checks;
}

function needsVoiceReadiness(profile: AgentFeatureProfile): boolean {
  return (
    profile.modalities.includes("voice") ||
    profile.linked_variables.some((variable) => variable.source_namespace === "VoiceCall")
  );
}

async function checkVoiceReadiness(conn: Connection): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  const voiceChannels = await queryOptional<VoiceMessagingChannelRecord>(
    conn,
    "SELECT Id, DeveloperName, MasterLabel, MessageType, IsActive, SessionHandlerId, FallbackQueueId FROM MessagingChannel WHERE MessageType = 'PstnVoice' LIMIT 5",
  );
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

async function queryOptional<T>(conn: Connection, soql: string): Promise<T[] | null> {
  try {
    const result = (await conn.query(soql)) as QueryResult<T>;
    return result.records ?? [];
  } catch {
    return null;
  }
}

function formatVoiceChannelEvidence(channel: VoiceMessagingChannelRecord): string {
  const label = channel.DeveloperName ?? channel.MasterLabel ?? channel.Id ?? "MessagingChannel";
  const flags = [
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
