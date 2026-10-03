/* SPDX-License-Identifier: Apache-2.0 */
/** Trace flag lifecycle for sf-apex. */

import type { ApexConnection as Connection } from "./api.ts";
import {
  apiVersion,
  createTooling,
  currentUserId,
  deleteTooling,
  patchTooling,
  toolingQuery,
} from "./api.ts";
import { buildApexDigest } from "./digest.ts";
import { traceConflictError } from "./errors.ts";
import { ok } from "./result.ts";
import { escapeSoql } from "./soql.ts";
import type { SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";

const DEBUG_LEVEL_NAME = "SF_PI_APEX";
const DEBUG_LEVEL_PROFILE = {
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
} as const;
const DEBUG_LEVEL_FIELDS = [
  "Id",
  "DeveloperName",
  "MasterLabel",
  "ApexCode",
  "ApexProfiling",
  "Callout",
  "Database",
  "System",
  "Validation",
  "Visualforce",
  "Workflow",
].join(", ");

interface DebugLevelRecord extends Record<string, unknown> {
  Id: string;
  DeveloperName: string;
  ApexCode?: string;
  ApexProfiling?: string;
  Callout?: string;
  Database?: string;
  System?: string;
  Validation?: string;
  Visualforce?: string;
  Workflow?: string;
}

interface TraceFlagRecord extends Record<string, unknown> {
  Id: string;
  TracedEntityId: string;
  LogType: string;
  DebugLevelId: string;
  StartDate: string;
  ExpirationDate: string;
}

interface TraceInventory {
  debugLevel?: DebugLevelRecord;
  managed: TraceFlagRecord[];
  external: TraceFlagRecord[];
}

export const DEFAULT_TRACE_MINUTES = 30;
export const MAX_TRACE_MINUTES = 120;

export async function status(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const userId = params.user_id ?? (await currentUserId(conn));
  const active = await activeTraceFlags(conn, userId);
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
        { method: "GET", path: "/tooling/query DebugLevel", detail: DEBUG_LEVEL_NAME },
        { method: "GET", path: "/tooling/query TraceFlag", detail: "active managed traces" },
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
              label: "Managed TraceFlags",
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
            ? "continue lifecycle or stop managed trace when finished"
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
  const minutes = requireTraceDuration(params.duration_minutes);
  const initial = await readTraceInventory(conn, userId);
  if (initial.managed.length === 0 && initial.external.length > 0) {
    throw traceConflictError(initial.external.length);
  }
  const now = new Date();
  const expiration = new Date(now.getTime() + minutes * 60_000);
  const debugLevel = initial.debugLevel ?? (await ensureDebugLevel(conn));
  const before = initial.debugLevel ? initial : await readTraceInventory(conn, userId, debugLevel);
  const stateIds = new Set(state?.lastTraceFlagIds ?? []);
  const existing = before.managed.find((trace) => stateIds.has(trace.Id)) ?? before.managed.at(0);
  const action = existing ? "refreshed" : "started";
  let traceId: string;

  if (existing) {
    traceId = existing.Id;
    await patchTooling(conn, "TraceFlag", traceId, {
      ExpirationDate: expiration.toISOString(),
      DebugLevelId: debugLevel.Id,
    });
  } else {
    const created = await createTooling<{ id?: string; success?: boolean }>(conn, "TraceFlag", {
      TracedEntityId: userId,
      LogType: "DEVELOPER_LOG",
      DebugLevelId: debugLevel.Id,
      StartDate: now.toISOString(),
      ExpirationDate: expiration.toISOString(),
    });
    if (!created.id) throw new Error("Apex trace verification failed: create returned no id.");
    traceId = created.id;
  }

  const observed = await findTraceFlagById(conn, traceId);
  requireVerifiedTrace(observed, {
    traceId,
    userId,
    debugLevelId: debugLevel.Id,
    expiration,
  });
  const after = await readTraceInventory(conn, userId, debugLevel);
  if (state) state.lastTraceFlagIds = [traceId];
  const externalPreserved = countPreserved(before.external, after.external);
  const verification = {
    status: "verified",
    checked_at: new Date().toISOString(),
    expected: {
      trace_flag_id: traceId,
      active: true,
      traced_entity_id: userId,
      debug_level_id: debugLevel.Id,
      expires_at: expiration.toISOString(),
    },
    observed: {
      trace_flag_id: observed.Id,
      active: true,
      traced_entity_id: observed.TracedEntityId,
      debug_level_id: observed.DebugLevelId,
      expires_at: observed.ExpirationDate,
      external_preserved: externalPreserved,
    },
  } as const;

  return ok(`Apex trace ${action} and verified for ${minutes} minute(s).`, {
    kind: "trace",
    action,
    user_id: userId,
    trace_flag_ids: [traceId],
    trace_flag: observed,
    active_trace_flags: after.managed,
    external_active_trace_flags: after.external,
    debug_level_id: debugLevel.Id,
    debug_level: debugLevel,
    expires_at: observed.ExpirationDate,
    verification,
    digest: traceCaptureDigest({
      params,
      action,
      userId,
      traceId,
      debugLevel,
      expiration,
      minutes,
      version: apiVersion(conn),
      externalPreserved,
    }),
  });
}

export async function stopTrace(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  const userId = params.user_id ?? (await currentUserId(conn));
  const before = await readTraceInventory(conn, userId);
  const stateIds = state?.lastTraceFlagIds?.length ? new Set(state.lastTraceFlagIds) : undefined;
  const selected = stateIds
    ? before.managed.filter((trace) => stateIds.has(trace.Id))
    : before.managed;
  const stoppedIds = selected.map((trace) => trace.Id);
  for (const traceId of stoppedIds) await deleteTooling(conn, "TraceFlag", traceId);

  const remainingStoppedIds: string[] = [];
  for (const traceId of stoppedIds) {
    if (await findTraceFlagById(conn, traceId)) remainingStoppedIds.push(traceId);
  }
  const after = await readTraceInventory(conn, userId, before.debugLevel);
  if (remainingStoppedIds.length) {
    throw new Error(
      `Apex trace verification failed: ${remainingStoppedIds.length} requested trace flag(s) remain active.`,
    );
  }
  if (state) state.lastTraceFlagIds = [];
  const externalPreserved = countPreserved(before.external, after.external);
  const verification = {
    status: "verified",
    checked_at: new Date().toISOString(),
    expected: { stopped_trace_flag_ids: stoppedIds },
    observed: {
      stopped_trace_flag_ids: stoppedIds,
      remaining_managed: after.managed.length,
      external_preserved: externalPreserved,
    },
  } as const;

  return ok(`Stopped and verified ${stoppedIds.length} managed Apex trace flag(s).`, {
    kind: "trace",
    action: "stopped",
    user_id: userId,
    stopped_trace_flag_ids: stoppedIds,
    active_trace_flags: after.managed,
    external_active_trace_flags: after.external,
    debug_level: before.debugLevel,
    verification,
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
        {
          method: "GET",
          path: "/tooling/query TraceFlag",
          detail: "partition managed and external",
        },
        {
          method: "DELETE",
          path: "/tooling/sobjects/TraceFlag",
          detail: `managed=${stoppedIds.length}`,
        },
        {
          method: "GET",
          path: "/tooling/query TraceFlag",
          detail: "verify exact ids absent",
        },
      ],
      sections: [
        {
          icon: "🛰️",
          title: "Capture",
          rows: [
            {
              icon: "✅",
              label: "Cleanup",
              value: `stopped ${stoppedIds.length} managed trace flag(s)`,
            },
            {
              icon: "🧾",
              label: "Stopped",
              value: stoppedIds.length ? shortList(stoppedIds) : "none",
            },
            {
              icon: after.managed.length ? "🟡" : "⚪",
              label: "Managed Remaining",
              value: `${after.managed.length} active`,
            },
          ],
        },
      ],
      evidenceRows: [
        { icon: "✅", label: "Readback", value: "exact stopped IDs absent" },
        {
          icon: "🛡️",
          label: "External",
          value: `${externalPreserved} trace flag(s) preserved`,
        },
      ],
      nextRows: [
        {
          icon: "🧭",
          label: "Recommend",
          value: after.managed.length
            ? "other managed traces remain active"
            : "no managed trace cleanup needed",
        },
      ],
    }),
  });
}

export async function traceStatus(conn: Connection, params: SfApexParams): Promise<ToolResult> {
  const userId = params.user_id ?? (await currentUserId(conn));
  const inventory = await readTraceInventory(conn, userId);
  return ok(
    `Managed Apex trace flags: ${inventory.managed.length}. External active trace flags: ${inventory.external.length}.`,
    {
      kind: "trace_status",
      user_id: userId,
      active_trace_flags: inventory.managed,
      external_active_trace_flags: inventory.external,
      debug_level: inventory.debugLevel,
      digest: traceStatusDigest(params, userId, inventory, apiVersion(conn)),
    },
  );
}

export async function activeTraceFlags(
  conn: Connection,
  userId: string,
): Promise<Record<string, unknown>[]> {
  return (await readTraceInventory(conn, userId)).managed;
}

async function readTraceInventory(
  conn: Connection,
  userId: string,
  knownDebugLevel?: DebugLevelRecord,
): Promise<TraceInventory> {
  const debugLevel = knownDebugLevel ?? (await findDebugLevel(conn));
  const active = await queryActiveTraceFlags(conn, userId);
  return {
    debugLevel,
    managed: debugLevel ? active.filter((trace) => trace.DebugLevelId === debugLevel.Id) : [],
    external: debugLevel ? active.filter((trace) => trace.DebugLevelId !== debugLevel.Id) : active,
  };
}

async function queryActiveTraceFlags(conn: Connection, userId: string): Promise<TraceFlagRecord[]> {
  const now = new Date().toISOString();
  return (
    await toolingQuery<TraceFlagRecord>(
      conn,
      `SELECT Id, TracedEntityId, LogType, DebugLevelId, StartDate, ExpirationDate FROM TraceFlag WHERE TracedEntityId = '${escapeSoql(userId)}' AND LogType = 'DEVELOPER_LOG' AND ExpirationDate > ${now} ORDER BY LastModifiedDate DESC LIMIT 20`,
    )
  ).records;
}

async function findTraceFlagById(
  conn: Connection,
  traceFlagId: string,
): Promise<TraceFlagRecord | undefined> {
  return (
    await toolingQuery<TraceFlagRecord>(
      conn,
      `SELECT Id, TracedEntityId, LogType, DebugLevelId, StartDate, ExpirationDate FROM TraceFlag WHERE Id = '${escapeSoql(traceFlagId)}' LIMIT 1`,
    )
  ).records[0];
}

function traceCaptureDigest(input: {
  params: SfApexParams;
  action: "started" | "refreshed";
  userId: string;
  traceId: string;
  debugLevel: DebugLevelRecord;
  expiration: Date;
  minutes: number;
  version: string;
  externalPreserved: number;
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
      {
        method: "GET",
        path: "/tooling/query TraceFlag",
        detail: `verify id=${shortId(input.traceId)}`,
      },
    ],
    sections: [
      {
        icon: "🛰️",
        title: "Capture",
        rows: [
          { icon: "🟢", label: "Status", value: "capturing Apex logs" },
          { icon: "👤", label: "User", value: input.userId },
          { icon: "🧾", label: "TraceFlag", value: shortId(input.traceId) },
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
        rows: debugLevelRows(input.debugLevel),
      },
    ],
    evidenceRows: [
      { icon: "✅", label: "Readback", value: "exact TraceFlag state observed" },
      {
        icon: "🛡️",
        label: "External",
        value: `${input.externalPreserved} trace flag(s) preserved`,
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
  inventory: TraceInventory,
  version: string,
) {
  const first = inventory.managed[0];
  const expiration = first ? new Date(first.ExpirationDate) : undefined;
  const traceIds = inventory.managed.map((trace) => trace.Id);
  return buildApexDigest({
    action: params.action,
    kind: "trace_status",
    status: "pass",
    icon: "🛰️",
    title: `Trace Capture · ${inventory.managed.length ? "active" : "inactive"}`,
    orgAlias: params.target_org,
    apiVersion: version,
    userId,
    meta: expiration ? [`expires ${relativeExpiration(expiration)}`] : undefined,
    apiCalls: [
      { method: "GET", path: "/tooling/query DebugLevel", detail: DEBUG_LEVEL_NAME },
      {
        method: "GET",
        path: "/tooling/query TraceFlag",
        detail: "partition managed and external",
      },
    ],
    sections: [
      {
        icon: "🛰️",
        title: "Capture",
        rows: inventory.managed.length
          ? [
              { icon: "🟢", label: "Status", value: "capturing Apex logs" },
              { icon: "👤", label: "User", value: userId },
              { icon: "🧾", label: "Managed", value: shortList(traceIds) },
              {
                icon: "⏳",
                label: "Expires",
                value: expiration
                  ? `${formatClock(expiration)} · ${relativeExpiration(expiration)}`
                  : "unknown",
              },
              {
                icon: inventory.external.length ? "🟡" : "⚪",
                label: "External",
                value: `${inventory.external.length} active · preserved`,
              },
            ]
          : [
              { icon: "⚪", label: "Status", value: "not capturing" },
              { icon: "👤", label: "User", value: userId },
              { icon: "🧾", label: "Managed", value: "0 active" },
              {
                icon: inventory.external.length ? "🟡" : "⚪",
                label: "External",
                value: `${inventory.external.length} active · preserved`,
              },
            ],
      },
      {
        icon: "🧰",
        title: "Debug Level",
        rows: inventory.debugLevel
          ? debugLevelRows(inventory.debugLevel)
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
        value: inventory.managed.length
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

function requireTraceDuration(value: number | undefined): number {
  const minutes = value ?? DEFAULT_TRACE_MINUTES;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TRACE_MINUTES) {
    throw new Error(`duration_minutes must be an integer from 1 to ${MAX_TRACE_MINUTES}.`);
  }
  return minutes;
}

function requireVerifiedTrace(
  observed: TraceFlagRecord | undefined,
  expected: {
    traceId: string;
    userId: string;
    debugLevelId: string;
    expiration: Date;
  },
): asserts observed is TraceFlagRecord {
  if (!observed) {
    throw new Error(`Apex trace verification failed: ${expected.traceId} was not read back.`);
  }
  const expectedExpiration = expected.expiration.getTime();
  const observedExpiration = Date.parse(observed.ExpirationDate);
  const valid =
    observed.Id === expected.traceId &&
    observed.TracedEntityId === expected.userId &&
    observed.LogType === "DEVELOPER_LOG" &&
    observed.DebugLevelId === expected.debugLevelId &&
    Number.isFinite(observedExpiration) &&
    Math.abs(observedExpiration - expectedExpiration) <= 1_000;
  if (!valid) {
    throw new Error(
      `Apex trace verification failed: ${expected.traceId} did not match the requested state.`,
    );
  }
}

function countPreserved(before: TraceFlagRecord[], after: TraceFlagRecord[]): number {
  const afterIds = new Set(after.map((trace) => trace.Id));
  return before.filter((trace) => afterIds.has(trace.Id)).length;
}

function debugLevelRows(debugLevel: DebugLevelRecord) {
  return [
    { icon: "🧰", label: "Name", value: debugLevel.DeveloperName },
    { icon: "⚙️", label: "ApexCode", value: String(debugLevel.ApexCode ?? "unknown") },
    { icon: "🧭", label: "System", value: String(debugLevel.System ?? "unknown") },
    { icon: "🗄️", label: "Database", value: String(debugLevel.Database ?? "unknown") },
    { icon: "🌐", label: "Callout", value: String(debugLevel.Callout ?? "unknown") },
    { icon: "🆔", label: "Id", value: debugLevel.Id },
  ];
}

async function findDebugLevel(conn: Connection): Promise<DebugLevelRecord | undefined> {
  return (
    await toolingQuery<DebugLevelRecord>(
      conn,
      `SELECT ${DEBUG_LEVEL_FIELDS} FROM DebugLevel WHERE DeveloperName = '${DEBUG_LEVEL_NAME}' LIMIT 1`,
    )
  ).records[0];
}

async function findDebugLevelById(
  conn: Connection,
  debugLevelId: string,
): Promise<DebugLevelRecord | undefined> {
  return (
    await toolingQuery<DebugLevelRecord>(
      conn,
      `SELECT ${DEBUG_LEVEL_FIELDS} FROM DebugLevel WHERE Id = '${escapeSoql(debugLevelId)}' LIMIT 1`,
    )
  ).records[0];
}

async function ensureDebugLevel(conn: Connection): Promise<DebugLevelRecord> {
  const existing = await findDebugLevel(conn);
  if (existing) return existing;
  const created = await createTooling<{ id?: string }>(conn, "DebugLevel", DEBUG_LEVEL_PROFILE);
  if (!created.id) {
    throw new Error("Apex debug level verification failed: create returned no id.");
  }
  const observed = await findDebugLevelById(conn, created.id);
  if (!observed || observed.DeveloperName !== DEBUG_LEVEL_NAME) {
    throw new Error(`Apex debug level verification failed: ${created.id} was not read back.`);
  }
  return observed;
}
