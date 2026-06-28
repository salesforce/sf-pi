/* SPDX-License-Identifier: Apache-2.0 */
/** Apex log fetch, watch, analyze, and artifact persistence. */

import { readFile } from "node:fs/promises";
import type { Connection } from "@salesforce/core";
import { apiVersion, currentUserId, requestText, toolingQuery } from "./api.ts";
import { artifactTimestamp, writeApexArtifact } from "./artifacts.ts";
import { parseApexLog, summarizeLogDigest } from "./log-parser.ts";
import { buildApexDigest, formatMs } from "./digest.ts";
import { fail, ok } from "./result.ts";
import { escapeSoql } from "./soql.ts";
import { startTrace } from "./trace.ts";
import type {
  ApexArtifact,
  ApexLogDigest,
  SfApexParams,
  SfApexSessionState,
  ToolResult,
} from "./types.ts";

export async function latestLog(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  const userId = params.user_id ?? (await currentUserId(conn));
  const logs = await queryLogs(conn, userId, undefined, 1);
  if (!logs[0]) return fail("No Apex logs found for the selected user.", { kind: "apex_log" });
  return fetchAndAnalyzeLog(conn, logs[0], state, params);
}

export async function getLog(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  if (!params.log_id) return fail("log_id is required for log.get.", { kind: "apex_log" });
  const logs = await toolingQuery<Record<string, unknown>>(
    conn,
    `SELECT Id, LogLength, StartTime, Operation, Request, Status, DurationMilliseconds, Location, RequestIdentifier FROM ApexLog WHERE Id = '${escapeSoql(params.log_id)}' LIMIT 1`,
  );
  if (!logs.records[0]) return fail(`Apex log not found: ${params.log_id}`, { kind: "apex_log" });
  return fetchAndAnalyzeLog(conn, logs.records[0], state, params);
}

export async function analyzeLog(params: SfApexParams): Promise<ToolResult> {
  const body = params.body ?? (params.file ? await readFile(params.file, "utf8") : undefined);
  if (!body) return fail("Provide body or file for log.analyze.", { kind: "apex_log" });
  const digest = parseApexLog(body);
  const stamp = artifactTimestamp();
  const digestArtifact = await writeApexArtifact("logs", `${stamp}.digest.json`, digest);
  return ok(summarizeLogDigest(digest), {
    kind: "apex_log",
    log_digest: digest,
    artifacts: [digestArtifact],
    digest: buildLogRunDigest(params, digest, [digestArtifact], undefined, "Local log parser"),
  });
}

export async function watchLog(
  conn: Connection,
  params: SfApexParams,
  state?: SfApexSessionState,
): Promise<ToolResult> {
  await startTrace(conn, params, state);
  const userId = params.user_id ?? (await currentUserId(conn));
  const startedAt = new Date();
  const waitMs = Math.min(params.wait_seconds ?? 30, 120) * 1000;
  const pollMs = Math.max(params.poll_interval_seconds ?? 2, 1) * 1000;
  const deadline = Date.now() + waitMs;

  while (Date.now() <= deadline) {
    const logs = await queryLogs(conn, userId, startedAt, 1);
    if (logs[0]) return fetchAndAnalyzeLog(conn, logs[0], state, params);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return fail(`No Apex log appeared within ${Math.round(waitMs / 1000)} second(s).`, {
    kind: "apex_log_watch",
    user_id: userId,
    started_at: startedAt.toISOString(),
  });
}

export async function queryLogs(
  conn: Connection,
  userId: string,
  since: Date | undefined,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const sinceClause = since ? ` AND StartTime >= ${since.toISOString()}` : "";
  return (
    await toolingQuery<Record<string, unknown>>(
      conn,
      `SELECT Id, LogLength, StartTime, Operation, Request, Status, DurationMilliseconds, Location, RequestIdentifier FROM ApexLog WHERE LogUserId = '${escapeSoql(userId)}'${sinceClause} ORDER BY StartTime DESC LIMIT ${limit}`,
    )
  ).records;
}

export async function waitForLog(
  conn: Connection,
  userId: string,
  since: Date,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const logs = await queryLogs(conn, userId, since, 1);
    if (logs.length > 0) return logs;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return [];
}

function buildLogRunDigest(
  params: SfApexParams,
  digest: ApexLogDigest,
  artifacts: ApexArtifact[],
  version?: string,
  mode?: string,
) {
  const exceptionCount = digest.counts.exceptions + digest.counts.fatal_errors;
  return buildApexDigest({
    action: params.action,
    kind: "apex_log",
    status: exceptionCount > 0 ? "fail" : "pass",
    icon: "🔎",
    title: exceptionCount > 0 ? "Apex Log Timeline · failed" : "Apex Log Timeline · clean",
    orgAlias: params.target_org,
    apiVersion: version,
    mode,
    apiCalls: logApiCalls(params, digest),
    meta: [
      digest.log_id ? `log=${digest.log_id.slice(0, 8)}…` : undefined,
      formatMs(digest.duration_ms),
    ].filter((item): item is string => Boolean(item)),
    sections: [
      ...rootCauseSection(digest),
      {
        icon: "⏱️",
        title: "Timeline",
        rows: timelineRows(digest),
      },
    ],
    signalRows: [
      {
        icon: exceptionCount > 0 ? "🔴" : "🟢",
        label: "Errors",
        value: `${exceptionCount} exception(s)`,
      },
      { icon: "💬", label: "Debug", value: `${digest.counts.user_debug} line(s)` },
      { icon: "🔢", label: "SOQL", value: formatLimit(digest, "SOQL queries", digest.counts.soql) },
      { icon: "📝", label: "DML", value: formatLimit(digest, "DML statements", digest.counts.dml) },
      {
        icon: "⏱️",
        label: "CPU",
        value: formatLimit(digest, "CPU time", digest.counts.cpu_ms, "ms"),
      },
      {
        icon: "🧠",
        label: "Heap",
        value: formatLimit(digest, "heap size", digest.counts.heap_bytes),
      },
      digest.user_debug[0]
        ? { icon: "🏷️", label: "Marker", value: digest.user_debug[0].message }
        : undefined,
    ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
    evidenceRows: [
      digest.log_id ? { icon: "🧾", label: "Log", value: digest.log_id } : undefined,
      { icon: "📁", label: "Saved", value: artifactSummary(artifacts) },
    ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
    nextRows: [
      {
        icon: "🧭",
        label: "Recommend",
        value:
          exceptionCount > 0
            ? "inspect stack trace and rerun focused test"
            : "continue lifecycle or run targeted tests",
      },
    ],
    artifacts,
  });
}

function timelineRows(digest: ApexLogDigest) {
  const maxRows = 12;
  const events = digest.timeline;
  const selected = events.length <= maxRows ? events : compactTimeline(events, maxRows - 1);
  const rows = selected.map((event) => ({
    icon: event.icon,
    label: event.offset_ms === undefined ? event.label : `+${event.offset_ms}ms`,
    value: `${event.label} · ${event.detail}`,
  }));
  const hidden = events.length - selected.length;
  return hidden > 0
    ? [
        ...rows,
        { icon: "👁️", label: "Hidden", value: `+${hidden} lower-signal event(s) in digest` },
      ]
    : rows;
}

function compactTimeline(events: ApexLogDigest["timeline"], maxRows: number) {
  const mustKeepKinds = new Set(["start", "code_unit", "exception", "fatal", "complete"]);
  const mustKeep = events.filter((event) => mustKeepKinds.has(event.kind));
  const remaining = events.filter((event) => !mustKeepKinds.has(event.kind));
  return [...mustKeep, ...remaining].slice(0, maxRows).sort((a, b) => {
    const left = a.offset_ms ?? -1;
    const right = b.offset_ms ?? -1;
    return left - right;
  });
}

function rootCauseSection(digest: ApexLogDigest) {
  const firstException = digest.exceptions[0];
  const firstFatal = digest.fatal_errors[0];
  if (!firstException && !firstFatal) return [];
  const marker = digest.user_debug[0]?.message;
  const rollbackObserved = digest.user_debug.some((debug) => /rollback/i.test(debug.message));
  return [
    {
      icon: "🔥",
      title: "Root Cause",
      rows: [
        {
          icon: "🔥",
          label: "Type",
          value: firstException?.type ?? "FATAL_ERROR",
        },
        {
          icon: "💬",
          label: "Message",
          value: firstException?.message ?? firstFatal ?? "unknown failure",
        },
        marker ? { icon: "🏷️", label: "Marker", value: marker } : undefined,
        rollbackObserved
          ? { icon: "↩️", label: "Rollback", value: "observed in debug markers" }
          : undefined,
      ].filter((row): row is { icon: string; label: string; value: string } => Boolean(row)),
    },
  ];
}

function logApiCalls(params: SfApexParams, digest: ApexLogDigest) {
  if (params.action === "log.analyze") {
    return [
      {
        method: "LOCAL",
        path: "Apex log parser",
        detail: `${digest.timeline.length} events · ${digest.counts.user_debug} debug`,
      },
    ];
  }
  if (params.action === "log.watch") {
    return [
      { method: "POST/PATCH", path: "/tooling/sobjects/TraceFlag", detail: "ensure capture" },
      {
        method: "GET",
        path: "/tooling/query ApexLog",
        detail: `poll · log=${shortId(digest.log_id)}`,
      },
      {
        method: "GET",
        path: "/tooling/sobjects/ApexLog/Body",
        detail: `id=${shortId(digest.log_id)}`,
      },
    ];
  }
  if (params.action === "log.latest") {
    return [
      { method: "GET", path: "/tooling/query ApexLog", detail: "latest for user" },
      {
        method: "GET",
        path: "/tooling/sobjects/ApexLog/Body",
        detail: `id=${shortId(digest.log_id)}`,
      },
    ];
  }
  return [
    {
      method: "GET",
      path: "/tooling/query ApexLog",
      detail: `metadata · id=${shortId(digest.log_id)}`,
    },
    {
      method: "GET",
      path: "/tooling/sobjects/ApexLog/Body",
      detail: `id=${shortId(digest.log_id)}`,
    },
  ];
}

function shortId(value: string | undefined): string {
  if (!value) return "unknown";
  return value.length > 10 ? `${value.slice(0, 3)}…${value.slice(-4)}` : value;
}

function formatLimit(
  digest: ApexLogDigest,
  label: string,
  used: number | undefined,
  suffix = "",
): string {
  const limit = digest.limits[label]?.limit;
  const usedText = `${used ?? 0}${suffix}`;
  return typeof limit === "number" ? `${usedText} / ${limit}${suffix}` : usedText;
}

function artifactSummary(artifacts: ApexArtifact[]): string {
  if (artifacts.length === 0) return "none";
  const kinds = [...new Set(artifacts.map((artifact) => artifact.kind))];
  return `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} · ${kinds.join(" + ")}`;
}

export async function fetchAndAnalyzeLog(
  conn: Connection,
  row: Record<string, unknown>,
  state?: SfApexSessionState,
  params?: SfApexParams,
): Promise<ToolResult> {
  const v = apiVersion(conn);
  const logId = String(row.Id);
  const body = await requestText(
    conn,
    "GET",
    `/services/data/v${v}/tooling/sobjects/ApexLog/${logId}/Body`,
  );
  const digest: ApexLogDigest = parseApexLog(body, {
    log_id: logId,
    operation: String(row.Operation ?? ""),
    status: String(row.Status ?? ""),
    start_time: String(row.StartTime ?? ""),
    duration_ms:
      typeof row.DurationMilliseconds === "number" ? row.DurationMilliseconds : undefined,
    log_length: typeof row.LogLength === "number" ? row.LogLength : undefined,
  });
  const stamp = artifactTimestamp();
  const logArtifact = await writeApexArtifact("logs", `${stamp}-${logId}.log`, body);
  const digestArtifact = await writeApexArtifact("logs", `${stamp}-${logId}.digest.json`, digest);
  if (state) state.lastLogId = logId;
  const artifacts = [logArtifact, digestArtifact];
  return ok(summarizeLogDigest(digest), {
    kind: "apex_log",
    log_id: logId,
    row,
    log_digest: digest,
    artifacts,
    digest: buildLogRunDigest(params ?? { action: "log.get" }, digest, artifacts, apiVersion(conn)),
  });
}
