/* SPDX-License-Identifier: Apache-2.0 */
/** Shared helpers for Surface Readiness Preflight adapters. */

import type { Connection } from "@salesforce/core";
import type { AgentFeatureProfile } from "../../feature-profile.ts";

export interface QueryResult<T> {
  records?: T[];
}

export interface ChannelRecord {
  Id?: string;
  DeveloperName?: string;
  MasterLabel?: string;
  MessageType?: string;
  IsActive?: boolean;
  SessionHandlerId?: string | null;
  FallbackQueueId?: string | null;
}

export function needsVoiceReadiness(profile: AgentFeatureProfile): boolean {
  return (
    profile.modalities.includes("voice") ||
    profile.linked_variables.some((variable) => variable.source_namespace === "VoiceCall")
  );
}

export function needsMessagingReadiness(profile: AgentFeatureProfile): boolean {
  return (
    profile.modalities.includes("messaging") ||
    profile.connection_names.some((name) => name.toLowerCase() === "messaging") ||
    profile.linked_variables.some((variable) => variable.source_namespace === "MessagingSession")
  );
}

export async function queryOptional<T>(conn: Connection, soql: string): Promise<T[] | null> {
  try {
    const result = (await conn.query(soql)) as QueryResult<T>;
    return result.records ?? [];
  } catch {
    return null;
  }
}

export async function queryChannels(
  conn: Connection,
  messageTypeWhere: string,
  limit: number,
): Promise<ChannelRecord[] | null> {
  return queryOptional<ChannelRecord>(
    conn,
    `SELECT Id, DeveloperName, MasterLabel, MessageType, IsActive, SessionHandlerId, FallbackQueueId FROM MessagingChannel WHERE ${messageTypeWhere} LIMIT ${limit}`,
  );
}

export function channelLabel(channel: ChannelRecord): string {
  return channel.DeveloperName ?? channel.MasterLabel ?? channel.Id ?? "MessagingChannel";
}

export function soqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}
