/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  buildFindSessionsSql,
  buildInteractionContextSql,
  buildSessionTimelineSql,
  runAgentObservabilityRunbook,
} from "../lib/facade/agent-observability.ts";
import type { QuerySqlResponse } from "../lib/facade/sql.ts";

describe("Agent observability runbooks", () => {
  it("builds bounded STDM session timeline SQL", () => {
    const sql = buildSessionTimelineSql("session'1", 9999);

    expect(sql).toContain('FROM "ssot__AiAgentInteraction__dlm" i');
    expect(sql).toContain('LEFT JOIN "ssot__AiAgentInteractionMessage__dlm" m');
    expect(sql).toContain("WHERE i.ssot__AiAgentSessionId__c = 'session''1'");
    expect(sql).toContain("LIMIT 500");
  });

  it("builds escaped interaction context SQL", () => {
    const sql = buildInteractionContextSql("interaction'1");

    expect(sql).toContain("WHERE i.ssot__Id__c = 'interaction''1'");
    expect(sql).toContain("ssot__TelemetryTraceId__c AS trace_id");
  });

  it("builds bounded STDM session discovery SQL", () => {
    const sql = buildFindSessionsSql({
      agent_api_name: "Service Agent's API",
      since: "2026-06-23",
      limit: 9999,
    });

    expect(sql).toContain('FROM "ssot__AiAgentSession__dlm" s');
    expect(sql).toContain('JOIN "ssot__AiAgentSessionParticipant__dlm" p');
    expect(sql).toContain("p.ssot__AiAgentApiName__c = 'Service Agent''s API'");
    expect(sql).toContain("s.ssot__StartTimestamp__c >= TIMESTAMP '2026-06-23 00:00:00'");
    expect(sql).toContain("LIMIT 100");
  });

  it("reconstructs a platform trace tree from query rows", async () => {
    const result = await runAgentObservabilityRunbook(
      "agent_observability.platform_trace_tree",
      { trace_id: "trace-1" },
      async () => spanRows(),
    );

    expect(result.markdown).toContain("🌳 Platform trace trace-1");
    expect(result.markdown).toContain("run.retriever.Knowledge");
    expect(result.data.summary).toMatchObject({ totalSpans: 2, errorCount: 0, maxDepth: 1 });
  });

  it("joins STDM interaction context to message, step, and trace queries", async () => {
    const seenSql: string[] = [];
    const result = await runAgentObservabilityRunbook(
      "agent_observability.join_interaction_trace",
      { interaction_id: "interaction-1" },
      async (sql) => {
        seenSql.push(sql);
        if (sql.includes('FROM "ssot__AiAgentInteraction__dlm"')) return interactionRows();
        if (sql.includes("AiAgentInteractionMessage")) return messageRows();
        if (sql.includes("AiAgentInteractionStep")) return stepRows();
        return spanRows();
      },
    );

    expect(seenSql.length).toBe(4);
    expect(result.markdown).toContain("🔗 STDM ↔ Platform Trace");
    expect(result.markdown).toContain("👤 yes");
    expect(result.markdown).toContain("run.retriever.Knowledge");
  });

  it("runs STDM session discovery", async () => {
    const result = await runAgentObservabilityRunbook(
      "agent_observability.stdm_find_sessions",
      { agent_api_name: "DemoAgent", since: "2026-06-23", limit: 5 },
      async () =>
        queryRows(
          [
            "session_id",
            "started",
            "ended",
            "channel",
            "end_type",
            "agent_api_name",
            "interaction_count",
          ],
          [["session-1", "start", "end", "Web", "USER_ENDED", "DemoAgent", 2]],
        ),
    );

    expect(result.markdown).toContain("🔎 STDM sessions: 1");
    expect(result.markdown).toContain("session-1");
    expect(result.data).toMatchObject({ rowCount: 1 });
  });

  it("returns STDM context with a warning when Platform Tracing is unavailable", async () => {
    const result = await runAgentObservabilityRunbook(
      "agent_observability.join_interaction_trace",
      { interaction_id: "interaction-1" },
      async (sql) => {
        if (sql.includes('FROM "ssot__AiAgentInteraction__dlm"')) return interactionRows();
        if (sql.includes("AiAgentInteractionMessage")) return messageRows();
        if (sql.includes("AiAgentInteractionStep")) return stepRows();
        throw new Error('table "ssot__TelemetryTraceSpan__dlm" does not exist');
      },
    );

    expect(result.markdown).toContain("⚠️ Platform trace unavailable");
    expect(result.markdown).toContain('table "ssot__TelemetryTraceSpan__dlm" does not exist');
    expect(result.data).toMatchObject({ traceAvailable: false });
  });
});

function queryRows(metadata: string[], data: unknown[][]): QuerySqlResponse {
  return { metadata: metadata.map((name) => ({ name })), data };
}

function spanRows(): QuerySqlResponse {
  return {
    metadata: [
      { name: "ssot__Id__c" },
      { name: "ssot__TelemetryTrace__c" },
      { name: "ssot__TelemetryParentSpanId__c" },
      { name: "ssot__OperationName__c" },
      { name: "ssot__ServiceName__c" },
      { name: "ssot__StatusCode__c" },
      { name: "ssot__DurationNumber__c" },
      { name: "ssot__StartDateTime__c" },
      { name: "ssot__EndDateTime__c" },
      { name: "ssot__TelemetrySpanAttributeText__c" },
    ],
    data: [
      [
        "root",
        "trace-1",
        "0000000000000000",
        "run.interaction",
        "Atlas",
        "OK",
        2_000_000,
        "2026-05-01T00:00:00Z",
        "2026-05-01T00:00:02Z",
        "{}",
      ],
      [
        "child",
        "trace-1",
        "root",
        "run.retriever.Knowledge",
        "Gateway",
        "OK",
        1_000_000,
        "2026-05-01T00:00:01Z",
        "2026-05-01T00:00:02Z",
        '{"retriever.numberofresults":10}',
      ],
    ],
  };
}

function interactionRows(): QuerySqlResponse {
  return {
    metadata: [
      { name: "interaction_id" },
      { name: "session_id" },
      { name: "topic" },
      { name: "interaction_started" },
      { name: "interaction_ended" },
      { name: "trace_id" },
    ],
    data: [["interaction-1", "session-1", "product_help", "start", "end", "trace-1"]],
  };
}

function messageRows(): QuerySqlResponse {
  return {
    metadata: [{ name: "who" }, { name: "text" }, { name: "sent_at" }],
    data: [["Input", "yes", "start"]],
  };
}

function stepRows(): QuerySqlResponse {
  return {
    metadata: [
      { name: "step_type" },
      { name: "step_name" },
      { name: "span_id" },
      { name: "error_text" },
      { name: "started" },
      { name: "ended" },
    ],
    data: [["ACTION_STEP", "search_knowledge", "child", "NOT_SET", "start", "end"]],
  };
}
