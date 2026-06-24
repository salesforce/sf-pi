/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic Agentforce observability runbooks for the d360 facade. */

import {
  buildFindErrorSpansSql,
  buildOperationPerformanceSql,
  buildSpanTree,
  buildTraceTreeSql,
  normalizePlatformSpanRow,
  summarizeSpanTree,
  type SpanTree,
  type SpanTreeNode,
  type SpanTreeSummary,
} from "../agent-observability/platform-tracing.ts";
import {
  boundedLimit,
  requiredString,
  rowsFromQuery,
  sinceTimestampPredicate,
  sqlString,
  type QuerySqlResponse,
} from "./sql.ts";

export const STDM_SESSION_DMO = "ssot__AiAgentSession__dlm";
export const STDM_PARTICIPANT_DMO = "ssot__AiAgentSessionParticipant__dlm";
export const STDM_INTERACTION_DMO = "ssot__AiAgentInteraction__dlm";
export const STDM_MESSAGE_DMO = "ssot__AiAgentInteractionMessage__dlm";
export const STDM_STEP_DMO = "ssot__AiAgentInteractionStep__dlm";

export interface QueryRunner {
  (sql: string): Promise<QuerySqlResponse>;
}

export interface RunbookResult {
  name: string;
  sql: string | Record<string, string>;
  data: Record<string, unknown>;
  markdown: string;
}

export async function runAgentObservabilityRunbook(
  name: string,
  params: Record<string, unknown>,
  query: QueryRunner,
): Promise<RunbookResult> {
  switch (name) {
    case "agent_observability.platform_error_traces":
      return runPlatformErrorTraces(params, query);
    case "agent_observability.platform_trace_tree":
      return runPlatformTraceTree(params, query);
    case "agent_observability.join_interaction_trace":
      return runJoinInteractionTrace(params, query);
    case "agent_observability.stdm_find_sessions":
      return runStdmFindSessions(params, query);
    case "agent_observability.stdm_session_timeline":
      return runStdmSessionTimeline(params, query);
    case "agent_observability.operation_latency_summary":
      return runOperationLatencySummary(params, query);
    default:
      throw new Error(`Unknown runbook: ${name}`);
  }
}

export function buildFindSessionsSql(params: Record<string, unknown>): string {
  const predicates = sinceTimestampPredicate(
    "s.ssot__StartTimestamp__c",
    params.since ?? defaultSinceTimestamp(),
  );
  const agentApiName = params.agent_api_name ?? params.agentApiName;
  if (typeof agentApiName === "string" && agentApiName.trim()) {
    predicates.push(`p.ssot__AiAgentApiName__c = ${sqlString(agentApiName.trim())}`);
  } else {
    predicates.push("p.ssot__AiAgentApiName__c <> 'NOT_SET'");
  }

  return [
    "SELECT s.ssot__Id__c AS session_id,",
    "       s.ssot__StartTimestamp__c AS started,",
    "       s.ssot__EndTimestamp__c AS ended,",
    "       s.ssot__AiAgentChannelType__c AS channel,",
    "       s.ssot__AiAgentSessionEndType__c AS end_type,",
    "       p.ssot__AiAgentApiName__c AS agent_api_name,",
    "       COUNT(i.ssot__Id__c) AS interaction_count",
    `FROM "${STDM_SESSION_DMO}" s`,
    `JOIN "${STDM_PARTICIPANT_DMO}" p`,
    "  ON p.ssot__AiAgentSessionId__c = s.ssot__Id__c",
    `LEFT JOIN "${STDM_INTERACTION_DMO}" i`,
    "  ON i.ssot__AiAgentSessionId__c = s.ssot__Id__c",
    `WHERE ${predicates.join(" AND ")}`,
    "GROUP BY s.ssot__Id__c, s.ssot__StartTimestamp__c, s.ssot__EndTimestamp__c, s.ssot__AiAgentChannelType__c, s.ssot__AiAgentSessionEndType__c, p.ssot__AiAgentApiName__c",
    "ORDER BY s.ssot__StartTimestamp__c DESC",
    `LIMIT ${boundedLimit(params.limit, 20, 100)}`,
  ].join("\n");
}

export function buildSessionTimelineSql(sessionId: string, limit?: unknown): string {
  const session = requiredString(sessionId, "session_id");
  return [
    "SELECT i.ssot__Id__c AS interaction_id,",
    "       i.ssot__TopicApiName__c AS topic,",
    "       i.ssot__TelemetryTraceId__c AS trace_id,",
    "       i.ssot__StartTimestamp__c AS turn_started,",
    "       m.ssot__AiAgentInteractionMessageType__c AS who,",
    "       m.ssot__ContentText__c AS text,",
    "       m.ssot__MessageSentTimestamp__c AS sent_at",
    `FROM "${STDM_INTERACTION_DMO}" i`,
    `LEFT JOIN "${STDM_MESSAGE_DMO}" m`,
    "  ON m.ssot__AiAgentInteractionId__c = i.ssot__Id__c",
    `WHERE i.ssot__AiAgentSessionId__c = ${sqlString(session)}`,
    "ORDER BY i.ssot__StartTimestamp__c ASC, m.ssot__MessageSentTimestamp__c ASC",
    `LIMIT ${boundedLimit(limit, 100, 500)}`,
  ].join("\n");
}

export function buildInteractionContextSql(interactionId: string): string {
  const interaction = requiredString(interactionId, "interaction_id");
  return [
    "SELECT i.ssot__Id__c AS interaction_id,",
    "       i.ssot__AiAgentSessionId__c AS session_id,",
    "       i.ssot__TopicApiName__c AS topic,",
    "       i.ssot__StartTimestamp__c AS interaction_started,",
    "       i.ssot__EndTimestamp__c AS interaction_ended,",
    "       i.ssot__TelemetryTraceId__c AS trace_id",
    `FROM "${STDM_INTERACTION_DMO}" i`,
    `WHERE i.ssot__Id__c = ${sqlString(interaction)}`,
    "LIMIT 1",
  ].join("\n");
}

export function buildInteractionMessagesSql(interactionId: string): string {
  const interaction = requiredString(interactionId, "interaction_id");
  return [
    "SELECT m.ssot__AiAgentInteractionMessageType__c AS who,",
    "       m.ssot__ContentText__c AS text,",
    "       m.ssot__MessageSentTimestamp__c AS sent_at",
    `FROM "${STDM_MESSAGE_DMO}" m`,
    `WHERE m.ssot__AiAgentInteractionId__c = ${sqlString(interaction)}`,
    "ORDER BY m.ssot__MessageSentTimestamp__c ASC",
    "LIMIT 50",
  ].join("\n");
}

export function buildInteractionStepsSql(interactionId: string): string {
  const interaction = requiredString(interactionId, "interaction_id");
  return [
    "SELECT st.ssot__AiAgentInteractionStepType__c AS step_type,",
    "       st.ssot__Name__c AS step_name,",
    "       st.ssot__TelemetryTraceSpanId__c AS span_id,",
    "       st.ssot__ErrorMessageText__c AS error_text,",
    "       st.ssot__StartTimestamp__c AS started,",
    "       st.ssot__EndTimestamp__c AS ended",
    `FROM "${STDM_STEP_DMO}" st`,
    `WHERE st.ssot__AiAgentInteractionId__c = ${sqlString(interaction)}`,
    "ORDER BY st.ssot__StartTimestamp__c ASC",
    "LIMIT 100",
  ].join("\n");
}

async function runPlatformErrorTraces(
  params: Record<string, unknown>,
  query: QueryRunner,
): Promise<RunbookResult> {
  const sql = buildFindErrorSpansSql({
    since: typeof params.since === "string" ? params.since : undefined,
    limit: typeof params.limit === "number" ? params.limit : undefined,
  });
  const response = await query(sql);
  const rows = rowsFromQuery(response);
  return {
    name: "agent_observability.platform_error_traces",
    sql,
    data: { rows, rowCount: rows.length },
    markdown: [`🔴 Platform error traces: ${rows.length}`, ...rows.map(renderErrorRow)].join("\n"),
  };
}

async function runPlatformTraceTree(
  params: Record<string, unknown>,
  query: QueryRunner,
): Promise<RunbookResult> {
  const traceId = requiredString(params.trace_id ?? params.traceId, "trace_id");
  const sql = buildTraceTreeSql(traceId);
  const response = await query(sql);
  const rows = rowsFromQuery(response);
  const spans = rows.map(normalizePlatformSpanRow);
  const tree = buildSpanTree(spans);
  const summary = summarizeSpanTree(tree);
  return {
    name: "agent_observability.platform_trace_tree",
    sql,
    data: { traceId, rows, tree, summary },
    markdown: renderTraceTree(traceId, tree, summary),
  };
}

async function runJoinInteractionTrace(
  params: Record<string, unknown>,
  query: QueryRunner,
): Promise<RunbookResult> {
  const interactionId = requiredString(
    params.interaction_id ?? params.interactionId,
    "interaction_id",
  );
  const contextSql = buildInteractionContextSql(interactionId);
  const messagesSql = buildInteractionMessagesSql(interactionId);
  const stepsSql = buildInteractionStepsSql(interactionId);

  const contextRows = rowsFromQuery(await query(contextSql));
  const context = contextRows[0];
  if (!context) throw new Error(`No STDM interaction found for '${interactionId}'.`);

  const traceId = requiredString(context.trace_id, "interaction trace_id");
  const traceSql = buildTraceTreeSql(traceId);
  const [messages, steps] = await Promise.all([
    query(messagesSql).then(rowsFromQuery),
    query(stepsSql).then(rowsFromQuery),
  ]);

  try {
    const traceResponse = await query(traceSql);
    const spans = rowsFromQuery(traceResponse).map(normalizePlatformSpanRow);
    const tree = buildSpanTree(spans);
    const summary = summarizeSpanTree(tree);

    return {
      name: "agent_observability.join_interaction_trace",
      sql: { context: contextSql, messages: messagesSql, steps: stepsSql, trace: traceSql },
      data: { interaction: context, messages, steps, tree, summary, traceAvailable: true },
      markdown: renderJoinedInteraction(context, messages, steps, traceId, tree, summary),
    };
  } catch (err) {
    const traceError = err instanceof Error ? err.message : String(err);
    return {
      name: "agent_observability.join_interaction_trace",
      sql: { context: contextSql, messages: messagesSql, steps: stepsSql, trace: traceSql },
      data: { interaction: context, messages, steps, traceAvailable: false, traceError },
      markdown: renderJoinedInteraction(
        context,
        messages,
        steps,
        traceId,
        undefined,
        undefined,
        traceError,
      ),
    };
  }
}

async function runStdmFindSessions(
  params: Record<string, unknown>,
  query: QueryRunner,
): Promise<RunbookResult> {
  const sql = buildFindSessionsSql(params);
  const rows = rowsFromQuery(await query(sql));
  return {
    name: "agent_observability.stdm_find_sessions",
    sql,
    data: { rows, rowCount: rows.length },
    markdown: [`🔎 STDM sessions: ${rows.length}`, ...rows.map(renderSessionRow)].join("\n"),
  };
}

async function runStdmSessionTimeline(
  params: Record<string, unknown>,
  query: QueryRunner,
): Promise<RunbookResult> {
  const sessionId = requiredString(params.session_id ?? params.sessionId, "session_id");
  const sql = buildSessionTimelineSql(sessionId, params.limit);
  const rows = rowsFromQuery(await query(sql));
  return {
    name: "agent_observability.stdm_session_timeline",
    sql,
    data: { sessionId, rows, rowCount: rows.length },
    markdown: [`💬 STDM session timeline ${sessionId}`, ...rows.map(renderTimelineRow)].join("\n"),
  };
}

async function runOperationLatencySummary(
  params: Record<string, unknown>,
  query: QueryRunner,
): Promise<RunbookResult> {
  const predicates = sinceTimestampPredicate("ssot__StartDateTime__c", params.since);
  const sql = buildOperationPerformanceSql({
    since: typeof params.since === "string" ? params.since : undefined,
    limit: typeof params.limit === "number" ? params.limit : undefined,
  });
  // Keep predicates referenced through the shared helper so invalid since values
  // fail here even if the APT helper's SQL grammar changes later.
  void predicates;
  const rows = rowsFromQuery(await query(sql));
  return {
    name: "agent_observability.operation_latency_summary",
    sql,
    data: { rows, rowCount: rows.length },
    markdown: [
      `📊 Operation latency summary: ${rows.length} row(s)`,
      ...rows.map(renderLatencyRow),
    ].join("\n"),
  };
}

function renderTraceTree(traceId: string, tree: SpanTree, summary: SpanTreeSummary): string {
  const lines = [
    `🌳 Platform trace ${traceId}`,
    `   spans=${summary.totalSpans} roots=${summary.rootCount} errors=${summary.errorCount} maxDepth=${summary.maxDepth}`,
  ];
  for (const root of tree.roots) renderNode(lines, root, "");
  return lines.join("\n");
}

function renderNode(lines: string[], node: SpanTreeNode, prefix: string): void {
  const ok = node.statusCode === "ERROR" ? "🔴" : "🟢";
  const duration = typeof node.durationMs === "number" ? `${Math.round(node.durationMs)}ms` : "n/a";
  lines.push(`${prefix}${ok} ${String(node.operationName ?? node.id)} — ${duration}`);
  node.children.forEach((child, index) =>
    renderNode(lines, child, `${prefix}${index === node.children.length - 1 ? "└─ " : "├─ "}`),
  );
}

function renderJoinedInteraction(
  interaction: Record<string, unknown>,
  messages: Record<string, unknown>[],
  steps: Record<string, unknown>[],
  traceId: string,
  tree?: SpanTree,
  summary?: SpanTreeSummary,
  traceError?: string,
): string {
  const traceBlock =
    tree && summary
      ? renderTraceTree(traceId, tree, summary)
      : `⚠️ Platform trace unavailable for ${traceId}\n   ${clip(traceError ?? "No Platform Tracing spans returned.", 220)}`;

  return [
    `🔗 STDM ↔ Platform Trace`,
    `   session=${String(interaction.session_id ?? "?")}`,
    `   interaction=${String(interaction.interaction_id ?? "?")}`,
    `   topic=${String(interaction.topic ?? "?")}`,
    `   trace=${traceId}`,
    `💬 messages=${messages.length}  🪜 steps=${steps.length}`,
    ...messages.map(renderMessageRow),
    traceBlock,
  ].join("\n");
}

function renderMessageRow(row: Record<string, unknown>): string {
  const who = row.who === "Input" ? "👤" : "🤖";
  return `   ${who} ${clip(String(row.text ?? ""), 160)}`;
}

function renderTimelineRow(row: Record<string, unknown>): string {
  return `   ${row.who === "Input" ? "👤" : "🤖"} [${String(row.topic ?? "?")}] ${clip(String(row.text ?? ""), 140)}`;
}

function renderSessionRow(row: Record<string, unknown>): string {
  const interactions = String(row.interaction_count ?? "?");
  return `   ${String(row.session_id ?? "?")} agent=${String(row.agent_api_name ?? "?")} started=${String(row.started ?? "?")} channel=${String(row.channel ?? "?")} interactions=${interactions}`;
}

function renderErrorRow(row: Record<string, unknown>): string {
  return `   🔴 ${String(row.ssot__OperationName__c ?? row.operation_name ?? "?")} trace=${String(row.ssot__TelemetryTrace__c ?? "?")} span=${String(row.ssot__Id__c ?? "?")}`;
}

function renderLatencyRow(row: Record<string, unknown>): string {
  return `   ⏱️ ${String(row.operation_name ?? row.ssot__OperationName__c ?? "?")} count=${String(row.span_count ?? "?")} avgNanos=${String(row.avg_duration_nanos ?? "?")}`;
}

function defaultSinceTimestamp(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
}

function clip(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
