/* SPDX-License-Identifier: Apache-2.0 */
/** Trace flag lifecycle for sf-apex. */

import type { Connection } from "@salesforce/core";
import {
  apiVersion,
  createTooling,
  currentUserId,
  deleteTooling,
  patchTooling,
  toolingQuery,
} from "./api.ts";
import { buildApexDigest } from "./digest.ts";
import { ok } from "./result.ts";
import { escapeSoql } from "./soql.ts";
import type { SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";

const DEBUG_LEVEL_NAME = "SF_PI_APEX";
const DEBUG_LEVEL_ROWS = [
  { icon: "🧰", label: "Name", value: DEBUG_LEVEL_NAME },
  { icon: "⚙️", label: "ApexCode", value: "FINEST" },
  { icon: "🧭", label: "System", value: "DEBUG" },
  { icon: "🗄️", label: "Database", value: "INFO" },
  { icon: "🌐", label: "Callout", value: "INFO" },
];
export const DEFAULT_TRACE_MINUTES = 30;
export const MAX_TRACE_MINUTES = 120;

export async function status(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const userId = await currentUserId(conn);
  const active = await activeTraceFlags(conn, params.user_id ?? userId);
  const version = apiVersion(conn);
  return ok(`SF Apex ready. Org API v${version}. Active SF Pi trace flags: ${active.length}.`, {
    kind: "status",
    api_version: version,
    user_id: userId,
    active_trace_flags: active,
    digest: buildApexDigest({
      action: params.action,
      kind: "status",
      status: "pass",
      icon: "⚡",
      title: "SF Apex Lifecycle · ready",
      orgAlias: params.target_org,
      apiVersion: version,
      userId,
      apiCalls: [
        { method: "GET", path: "/oauth2/userinfo", detail: "current user" },
        { method: "GET", path: "/tooling/query TraceFlag", detail: "active SF Pi traces" },
      ],
      sections: [
        {
          icon: "✅",
          title: "Readiness",
          rows: [
            { icon: "🟢", label: "Connection", value: "ready" },
            { icon: "🌐", label: "API", value: `v${version}` },
            { icon: "👤", label: "User", value: userId },
            {
              icon: active.length ? "🟢" : "⚪",
              label: "TraceFlags",
              value: `${active.length} active`,
            },
          ],
        },
        {
          icon: "🔁",
          title: "Available Loop",
          rows: [
            { icon: "🧭", label: "Plan", value: "author.plan" },
            { icon: "🚦", label: "Gate", value: "diagnose.file" },
            { icon: "🧪", label: "Test", value: "test.run / test.result / test.rerun" },
            { icon: "🛰️", label: "Trace", value: "trace.start / trace.status / trace.stop" },
            { icon: "🔎", label: "Observe", value: "log.latest / log.watch / log.get" },
            { icon: "⚡", label: "Probe", value: "anon.run" },
          ],
        },
      ],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: active.length
            ? "continue lifecycle or stop trace when finished"
            : "start trace or run a targeted Apex action",
        },
      ],
    }),
  });
}

export async function startTrace(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  const userId = params.user_id ?? (await currentUserId(conn));
  const minutes = Math.min(params.duration_minutes ?? DEFAULT_TRACE_MINUTES, MAX_TRACE_MINUTES);
  const now = new Date();
  const expiration = new Date(now.getTime() + minutes * 60_000);
  const debugLevelId = await ensureDebugLevel(conn);
  const existing = await activeTraceFlags(conn, userId);

  if (existing.length > 0) {
    for (const trace of existing) {
      await patchTooling(conn, "TraceFlag", String(trace.Id), {
        ExpirationDate: expiration.toISOString(),
        DebugLevelId: debugLevelId,
      });
    }
    if (state) state.lastTraceFlagIds = existing.map((trace) => String(trace.Id));
    const traceIds = existing.map((trace) => String(trace.Id));
    return ok(`Apex trace refreshed for ${minutes} minute(s).`, {
      kind: "trace",
      action: "refreshed",
      user_id: userId,
      trace_flag_ids: traceIds,
      debug_level_id: debugLevelId,
      expires_at: expiration.toISOString(),
      digest: traceCaptureDigest({
        params,
        state: "active",
        action: "refreshed",
        userId,
        traceIds,
        debugLevelId,
        expiration,
        minutes,
        version: apiVersion(conn),
      }),
    });
  }

  const created = await createTooling<{ id: string }>(conn, "TraceFlag", {
    TracedEntityId: userId,
    LogType: "DEVELOPER_LOG",
    DebugLevelId: debugLevelId,
    StartDate: now.toISOString(),
    ExpirationDate: expiration.toISOString(),
  });
  if (state) state.lastTraceFlagIds = [created.id];
  return ok(`Apex trace started for ${minutes} minute(s).`, {
    kind: "trace",
    action: "started",
    user_id: userId,
    trace_flag_ids: [created.id],
    debug_level_id: debugLevelId,
    expires_at: expiration.toISOString(),
    digest: traceCaptureDigest({
      params,
      state: "active",
      action: "started",
      userId,
      traceIds: [created.id],
      debugLevelId,
      expiration,
      minutes,
      version: apiVersion(conn),
    }),
  });
}

export async function stopTrace(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  const userId = params.user_id ?? (await currentUserId(conn));
  const active = await activeTraceFlags(conn, userId);
  for (const trace of active) await deleteTooling(conn, "TraceFlag", String(trace.Id));
  if (state) state.lastTraceFlagIds = [];
  const stoppedIds = active.map((trace) => String(trace.Id));
  return ok(`Stopped ${active.length} Apex trace flag(s).`, {
    kind: "trace",
    action: "stopped",
    user_id: userId,
    stopped_trace_flag_ids: stoppedIds,
    digest: buildApexDigest({
      action: params.action,
      kind: "trace",
      status: "pass",
      icon: "🛰️",
      title: "Trace Capture · stopped",
      orgAlias: params.target_org,
      apiVersion: apiVersion(conn),
      userId,
      apiCalls: [
        { method: "GET", path: "/tooling/query TraceFlag", detail: "active traces" },
        {
          method: "DELETE",
          path: "/tooling/sobjects/TraceFlag",
          detail: `stopped=${stoppedIds.length}`,
        },
      ],
      sections: [
        {
          icon: "🛰️",
          title: "Capture",
          rows: [
            { icon: "✅", label: "Cleanup", value: `stopped ${active.length} trace flag(s)` },
            {
              icon: "🧾",
              label: "Stopped",
              value: stoppedIds.length ? shortList(stoppedIds) : "none",
            },
            { icon: "⚪", label: "Remaining", value: "0 active" },
          ],
        },
      ],
      nextRows: [{ icon: "🧭", label: "Recommend", value: "no trace cleanup needed" }],
    }),
  });
}

export async function traceStatus(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const userId = params.user_id ?? (await currentUserId(conn));
  const active = await activeTraceFlags(conn, userId);
  return ok(`Active Apex trace flags: ${active.length}.`, {
    kind: "trace_status",
    user_id: userId,
    active_trace_flags: active,
    digest: traceStatusDigest(params, userId, active, apiVersion(conn)),
  });
}

export async function activeTraceFlags(
  conn: Connection,
  userId: string,
): Promise<Record<string, unknown>[]> {
  const now = new Date().toISOString();
  return (
    await toolingQuery<Record<string, unknown>>(
      conn,
      `SELECT Id, TracedEntityId, LogType, DebugLevelId, StartDate, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${escapeSoql(userId)}' AND LogType = 'DEVELOPER_LOG' AND ExpirationDate > ${now} ORDER BY LastModifiedDate DESC LIMIT 20`,
    )
  ).records;
}

function traceCaptureDigest(input: {
  params: SfApexParams;
  state: "active";
  action: "started" | "refreshed";
  userId: string;
  traceIds: string[];
  debugLevelId: string;
  expiration: Date;
  minutes: number;
  version: string;
}) {
  return buildApexDigest({
    action: input.params.action,
    kind: "trace",
    status: "pass",
    icon: "🛰️",
    title: "Trace Capture · active",
    orgAlias: input.params.target_org,
    apiVersion: input.version,
    userId: input.userId,
    meta: [`expires ${relativeExpiration(input.expiration)}`],
    apiCalls: [
      {
        method: "GET",
        path: "/tooling/query DebugLevel",
        detail: `DeveloperName=${DEBUG_LEVEL_NAME}`,
      },
      {
        method: input.action === "started" ? "POST" : "PATCH",
        path: "/tooling/sobjects/TraceFlag",
        detail: `user=${shortId(input.userId)} · ttl=${input.minutes}m · debug=${DEBUG_LEVEL_NAME}`,
      },
    ],
    sections: [
      {
        icon: "🛰️",
        title: "Capture",
        rows: [
          { icon: "🟢", label: "Status", value: "capturing Apex logs" },
          { icon: "👤", label: "User", value: input.userId },
          { icon: "🧾", label: "TraceFlag", value: shortList(input.traceIds) },
          {
            icon: "⏳",
            label: "Window",
            value: `${input.minutes}m · expires ${formatClock(input.expiration)}`,
          },
        ],
      },
      {
        icon: "🧰",
        title: "Debug Level",
        rows: [...DEBUG_LEVEL_ROWS, { icon: "🆔", label: "Id", value: input.debugLevelId }],
      },
    ],
    nextRows: [
      {
        icon: "🧭",
        label: "Recommend",
        value: "reproduce behavior, run anon.run/test.run, then inspect log timeline",
      },
    ],
  });
}

function traceStatusDigest(
  params: SfApexParams,
  userId: string,
  active: Record<string, unknown>[],
  version: string,
) {
  const first = active[0];
  const expiration =
    typeof first?.ExpirationDate === "string" ? new Date(first.ExpirationDate) : undefined;
  const traceIds = active.map((trace) => String(trace.Id));
  return buildApexDigest({
    action: params.action,
    kind: "trace_status",
    status: "pass",
    icon: "🛰️",
    title: `Trace Capture · ${active.length ? "active" : "inactive"}`,
    orgAlias: params.target_org,
    apiVersion: version,
    userId,
    meta: expiration ? [`expires ${relativeExpiration(expiration)}`] : undefined,
    apiCalls: [
      { method: "GET", path: "/tooling/query TraceFlag", detail: "current user · active traces" },
    ],
    sections: [
      {
        icon: "🛰️",
        title: "Capture",
        rows: active.length
          ? [
              { icon: "🟢", label: "Status", value: "capturing Apex logs" },
              { icon: "👤", label: "User", value: userId },
              { icon: "🧾", label: "TraceFlags", value: shortList(traceIds) },
              {
                icon: "⏳",
                label: "Expires",
                value: expiration
                  ? `${formatClock(expiration)} · ${relativeExpiration(expiration)}`
                  : "unknown",
              },
            ]
          : [
              { icon: "⚪", label: "Status", value: "not capturing" },
              { icon: "👤", label: "User", value: userId },
              { icon: "🧾", label: "TraceFlags", value: "0 active" },
            ],
      },
      {
        icon: "🧰",
        title: "Debug Level",
        rows: active.length
          ? DEBUG_LEVEL_ROWS
          : [
              {
                icon: "🧰",
                label: "Name",
                value: `${DEBUG_LEVEL_NAME} available when trace starts`,
              },
            ],
      },
    ],
    nextRows: [
      {
        icon: "🧭",
        label: "Recommend",
        value: active.length
          ? "run behavior, then inspect Apex Log Timeline"
          : "start trace before reproducing Apex behavior",
      },
    ],
  });
}

function shortList(values: string[]): string {
  if (values.length === 0) return "none";
  const visible = values.slice(0, 3).map(shortId).join(", ");
  return values.length > 3 ? `${visible}, +${values.length - 3} more` : visible;
}

function shortId(value: string): string {
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function relativeExpiration(date: Date): string {
  const deltaMs = date.getTime() - Date.now();
  if (deltaMs <= 0) return "expired";
  const minutes = Math.floor(deltaMs / 60_000);
  const seconds = Math.round((deltaMs % 60_000) / 1000);
  if (minutes <= 0) return `${seconds}s remaining`;
  return `${minutes}m ${seconds.toString().padStart(2, "0")}s remaining`;
}

async function ensureDebugLevel(conn: Connection): Promise<string> {
  const existing = await toolingQuery<Record<string, unknown>>(
    conn,
    `SELECT Id FROM DebugLevel WHERE DeveloperName = '${DEBUG_LEVEL_NAME}' LIMIT 1`,
  );
  if (existing.records[0]?.Id) return String(existing.records[0].Id);
  const created = await createTooling<{ id: string }>(conn, "DebugLevel", {
    DeveloperName: DEBUG_LEVEL_NAME,
    MasterLabel: DEBUG_LEVEL_NAME,
    Language: "en_US",
    ApexCode: "FINEST",
    ApexProfiling: "INFO",
    Callout: "INFO",
    Database: "INFO",
    System: "DEBUG",
    Validation: "INFO",
    Visualforce: "INFO",
    Workflow: "INFO",
  });
  return created.id;
}
