/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only queue readiness checks for channel fallback queues. */

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

interface GroupRow {
  Id?: string;
  DeveloperName?: string;
  Name?: string;
  QueueRoutingConfigId?: string | null;
}

interface QueueSObjectRow {
  QueueId?: string;
  SobjectType?: string;
}

interface GroupMemberRow {
  GroupId?: string;
  UserOrGroupId?: string;
}

interface QueueRoutingConfigRow {
  Id?: string;
  DeveloperName?: string;
  MasterLabel?: string;
  RoutingModel?: string;
}

export async function checkQueueReadiness(
  conn: Connection,
  profile: AgentFeatureProfile,
): Promise<SurfaceReadinessCheck[]> {
  const checks: SurfaceReadinessCheck[] = [];
  if (needsVoiceReadiness(profile)) {
    const channels = await queryChannels(conn, "MessageType = 'PstnVoice'", 5);
    if (channels) checks.push(...(await checkChannels(conn, "voice", channels, "VoiceCall")));
  }
  if (needsMessagingReadiness(profile)) {
    const channels = await queryChannels(conn, "MessageType != 'PstnVoice'", 10);
    if (channels) {
      checks.push(...(await checkChannels(conn, "messaging", channels, "MessagingSession")));
    }
  }
  return checks;
}

async function checkChannels(
  conn: Connection,
  surface: "voice" | "messaging",
  channels: ChannelRecord[],
  requiredSObject: "VoiceCall" | "MessagingSession",
): Promise<SurfaceReadinessCheck[]> {
  const queueIds = Array.from(
    new Set(
      channels
        .map((channel) => channel.FallbackQueueId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  if (queueIds.length === 0) return [];

  const queues = await findQueues(conn, queueIds);
  if (queues === null) {
    return [
      {
        code: `${surface}-queue-unverifiable`,
        surface,
        status: "unverifiable",
        message: "Could not verify fallback queue records for channel routing.",
      },
    ];
  }
  const queueById = new Map(queues.map((queue) => [queue.Id, queue]));
  const checks: SurfaceReadinessCheck[] = [];
  for (const channel of channels) {
    const queueId = channel.FallbackQueueId;
    if (!queueId) continue;
    const queue = queueById.get(queueId);
    if (!queue) {
      checks.push({
        code: `${surface}-fallback-queue-missing`,
        surface,
        status: "warning",
        message:
          "Channel FallbackQueueId does not resolve to a queue. Escalation or fallback routing may fail.",
        evidence: [`${channelLabel(channel)}: ${queueId}`],
      });
    }
  }

  const foundQueueIds = queues.map((queue) => queue.Id).filter((id): id is string => !!id);
  if (foundQueueIds.length === 0) return checks;

  const queueSObjects = await findQueueSObjects(conn, foundQueueIds, requiredSObject);
  if (queueSObjects === null) {
    checks.push({
      code: `${surface}-queue-sobject-unverifiable`,
      surface,
      status: "unverifiable",
      message: `Could not verify whether fallback queues support ${requiredSObject}.`,
    });
  } else {
    const supported = new Set(queueSObjects.map((row) => row.QueueId).filter(Boolean));
    for (const queue of queues) {
      if (!queue.Id || supported.has(queue.Id)) continue;
      checks.push({
        code: `${surface}-queue-sobject-missing`,
        surface,
        status: "warning",
        message: `Fallback queue does not appear to support ${requiredSObject}. Channel work may not be accepted by the queue.`,
        evidence: [formatQueueEvidence(queue)],
      });
    }
  }

  const members = await findGroupMembers(conn, foundQueueIds);
  if (members === null) {
    checks.push({
      code: `${surface}-queue-members-unverifiable`,
      surface,
      status: "unverifiable",
      message: "Could not verify fallback queue membership.",
    });
  } else {
    const memberQueues = new Set(members.map((row) => row.GroupId).filter(Boolean));
    for (const queue of queues) {
      if (!queue.Id || memberQueues.has(queue.Id)) continue;
      checks.push({
        code: `${surface}-queue-members-missing`,
        surface,
        status: "warning",
        message:
          "Fallback queue has no direct members. Human handoff or fallback work may not be accepted.",
        evidence: [formatQueueEvidence(queue)],
      });
    }
  }

  const routingConfigIds = queues
    .map((queue) => queue.QueueRoutingConfigId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  const queuesWithoutRoutingConfig = queues.filter((queue) => !queue.QueueRoutingConfigId);
  for (const queue of queuesWithoutRoutingConfig) {
    checks.push({
      code: `${surface}-queue-routing-config-missing`,
      surface,
      status: "warning",
      message:
        "Fallback queue has no QueueRoutingConfigId. Review routing configuration before end-to-end channel testing.",
      evidence: [formatQueueEvidence(queue)],
    });
  }
  if (routingConfigIds.length > 0) {
    const configs = await findQueueRoutingConfigs(conn, routingConfigIds);
    if (configs === null) {
      checks.push({
        code: `${surface}-queue-routing-config-unverifiable`,
        surface,
        status: "unverifiable",
        message: "Could not verify fallback queue routing configuration records.",
      });
    } else {
      const configById = new Map(configs.map((config) => [config.Id, config]));
      for (const queue of queues) {
        const configId = queue.QueueRoutingConfigId;
        if (!configId) continue;
        const config = configById.get(configId);
        if (!config) {
          checks.push({
            code: `${surface}-queue-routing-config-missing-record`,
            surface,
            status: "warning",
            message: "Fallback queue references a QueueRoutingConfig that could not be found.",
            evidence: [formatQueueEvidence(queue)],
          });
        }
      }
    }
  }

  return checks;
}

async function findQueues(conn: Connection, queueIds: string[]): Promise<GroupRow[] | null> {
  return queryOptional<GroupRow>(
    conn,
    `SELECT Id, DeveloperName, Name, QueueRoutingConfigId FROM Group WHERE Type='Queue' AND Id IN (${soqlInList(queueIds)})`,
  );
}

async function findQueueSObjects(
  conn: Connection,
  queueIds: string[],
  sobjectType: string,
): Promise<QueueSObjectRow[] | null> {
  return queryOptional<QueueSObjectRow>(
    conn,
    `SELECT QueueId, SobjectType FROM QueueSObject WHERE QueueId IN (${soqlInList(queueIds)}) AND SobjectType='${soqlEscape(sobjectType)}'`,
  );
}

async function findGroupMembers(
  conn: Connection,
  queueIds: string[],
): Promise<GroupMemberRow[] | null> {
  return queryOptional<GroupMemberRow>(
    conn,
    `SELECT GroupId, UserOrGroupId FROM GroupMember WHERE GroupId IN (${soqlInList(queueIds)}) LIMIT 200`,
  );
}

async function findQueueRoutingConfigs(
  conn: Connection,
  configIds: string[],
): Promise<QueueRoutingConfigRow[] | null> {
  return queryOptional<QueueRoutingConfigRow>(
    conn,
    `SELECT Id, DeveloperName, MasterLabel, RoutingModel FROM QueueRoutingConfig WHERE Id IN (${soqlInList(configIds)})`,
  );
}

function formatQueueEvidence(queue: GroupRow): string {
  const label = queue.DeveloperName ?? queue.Name ?? queue.Id ?? "Queue";
  return `${label}${queue.QueueRoutingConfigId ? ` (routing config set)` : ""}`;
}

function soqlInList(values: string[]): string {
  return values.map((value) => `'${soqlEscape(value)}'`).join(",");
}
