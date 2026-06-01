# Agent Platform Tracing

Agent Platform Tracing captures backend execution for Agentforce activity as
OpenTelemetry-style spans in Data Cloud. Use it when the question is about
what happened inside an action path: LLM-step latency, action execution,
Flow/Apex invocation, retriever/search spans, errors, and the parent-child
trace tree for one transaction.

Agent Platform Tracing is independent from Agentforce Session Tracing (STDM):

- **STDM** answers conversational questions: session, turn, user text, topic,
  agent response, and planner step I/O.
- **Agent Platform Tracing** answers backend execution questions: spans,
  operation names, service names, duration, status, and trace-tree shape.

When both are enabled, join them with:

```text
ssot__AiAgentInteraction__dlm.ssot__TelemetryTraceId__c
  = ssot__TelemetryTraceSpan__dlm.ssot__TelemetryTrace__c
```

## Pre-flight

1. **Probe Data 360 first.** Run `d360_probe`. The optional
   `agent_platform_tracing_dlo` probe checks whether the raw span DLO is
   visible at `/ssot/data-lake-objects/ObservabilitySpans__dll`.
2. **Describe the raw DLO before querying.** Run
   `d360_metadata action="describe_dlo" api_name="ObservabilitySpans__dll"`
   in a new org. The harmonized DMO `ssot__TelemetryTraceSpan__dlm` is the
   normal SQL surface, but it may not appear in the compact DMO catalog and
   some orgs can return a server error from the normal DMO describe endpoint.
   If DLO describe works, use a bounded DMO `COUNT(*)` smoke before sampling
   rows.
3. **Resolve the data space.** `d360_api GET /ssot/data-spaces` and pick the
   active data space name, commonly `default`. Pass it as the
   `dataspaceName` query parameter on `/ssot/query-sql` when the org
   requires it.
4. **Keep windows bounded.** Span tables can grow quickly. Prefer `LIMIT`, a
   trace id filter, or a time window.

## Data surfaces

### DMO: `ssot__TelemetryTraceSpan__dlm`

Use this for normal queries. It is the harmonized Data Model Object for span
analysis.

| Field                                             | What it is                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `ssot__Id__c`                                     | Span id.                                                                        |
| `ssot__TelemetryTrace__c`                         | Trace/group id. Fetch all spans for this id to reconstruct one tree.            |
| `ssot__TelemetryParentSpanId__c`                  | Parent span id. `0000000000000000` means root.                                  |
| `ssot__OperationName__c`                          | Operation name, for example `run.llmstep`, `run.action.*`, or Apex entry spans. |
| `ssot__ServiceName__c`                            | Originating service.                                                            |
| `ssot__SpanKind__c`                               | Span kind.                                                                      |
| `ssot__StartDateTime__c` / `ssot__EndDateTime__c` | Span window.                                                                    |
| `ssot__DurationNumber__c`                         | Duration in nanoseconds. Divide by `1_000_000` for milliseconds.                |
| `ssot__StatusCode__c`                             | `OK` or `ERROR`. Not an HTTP status code.                                       |
| `ssot__TelemetrySpanAttributeText__c`             | JSON attribute bag when populated. Often `{}`.                                  |

### DLO: `ObservabilitySpans__dll`

Use the raw Data Lake Object for readiness checks, ingestion checks, or mapping
debugging. Normal analysis should use `ssot__TelemetryTraceSpan__dlm`.

Common raw fields include `spanId__c`, `traceId__c`, `parentSpanId__c`,
`operationName__c`, `serviceName__c`, `startDateTime__c`, `endDateTime__c`,
`durationNanos__c`, `statusCode__c`, and `attributes__c`.

## Known operation-name families

Observed spans commonly fall into these families:

```text
run.interaction
run.llmstep
run.topic.*
run.action.*
run.invokeActions.*
run.decision.*
run.flowStart
run.flowEnd
apexentrypoint.invocable_action
run.retriever.*
run.hybridsearch.*
run.step.*
run.einstein_gpt__*
```

Treat this as a discovery aid, not an exhaustive contract. New services can add
new operation names without a client change.

## Quirks that bite

1. **Status is `OK` / `ERROR`.** Do not look for HTTP-style numeric status
   codes in `ssot__StatusCode__c`.
2. **Durations are nanoseconds.** Convert `ssot__DurationNumber__c / 1_000_000`
   before presenting user-facing latency.
3. **Root parent sentinel.** Treat `null`, missing parent, and
   `0000000000000000` as root. Surface missing non-root parents as orphans;
   do not drop them.
4. **Attributes are sparse.** `ssot__TelemetrySpanAttributeText__c` can be `{}`
   for many span types and richer for retriever, prompt, or data-access spans.
5. **DMO vs DLO suffixes differ.** The DMO is `ssot__TelemetryTraceSpan__dlm`;
   the DLO is `ObservabilitySpans__dll`.
6. **Data Cloud SQL is not SOQL.** The examples below use
   `/ssot/query-sql` grammar with double-quoted DMO names and
   `TIMESTAMP 'YYYY-MM-DD HH:MM:SS'` literals.
7. **Expect propagation lag.** Do not assume a just-completed interaction is
   immediately queryable in Data Cloud.

## Query recipes

Every query below uses:

```json
{
  "method": "POST",
  "path": "/ssot/query-sql",
  "query": { "dataspaceName": "default" },
  "body": { "sql": "..." },
  "output_mode": "summary"
}
```

Use the active data space name for your org. Omit the `query` block if the
org's `/ssot/query-sql` surface does not require an explicit data space.

### Q1 — Find recent error spans

```sql
SELECT ssot__Id__c,
       ssot__TelemetryTrace__c,
       ssot__TelemetryParentSpanId__c,
       ssot__OperationName__c,
       ssot__ServiceName__c,
       ssot__StatusCode__c,
       ssot__DurationNumber__c,
       ssot__StartDateTime__c,
       ssot__EndDateTime__c,
       ssot__TelemetrySpanAttributeText__c
FROM "ssot__TelemetryTraceSpan__dlm"
WHERE ssot__StatusCode__c = 'ERROR'
  AND ssot__StartDateTime__c >= TIMESTAMP '2026-05-01 00:00:00'
ORDER BY ssot__StartDateTime__c DESC
LIMIT 20
```

Use `ssot__TelemetryTrace__c` from a returned row to fetch the full tree.

### Q2 — Fetch the full trace tree for one trace id

```sql
SELECT ssot__Id__c,
       ssot__TelemetryTrace__c,
       ssot__TelemetryParentSpanId__c,
       ssot__OperationName__c,
       ssot__ServiceName__c,
       ssot__StatusCode__c,
       ssot__DurationNumber__c,
       ssot__StartDateTime__c,
       ssot__EndDateTime__c,
       ssot__TelemetrySpanAttributeText__c
FROM "ssot__TelemetryTraceSpan__dlm"
WHERE ssot__TelemetryTrace__c = '<trace_id>'
ORDER BY ssot__StartDateTime__c ASC
LIMIT 500
```

Then reconstruct the tree client-side:

1. Normalize each row by span id: `id = ssot__Id__c`.
2. Treat `ssot__TelemetryParentSpanId__c` of `null` or
   `0000000000000000` as root.
3. Attach each child to the span whose `ssot__Id__c` equals its parent id.
4. Keep orphan spans as roots with an `orphanParentId`; they are useful drift
   signals.
5. Convert durations from nanos to milliseconds.

The pure helper in
`extensions/sf-data360/lib/agent-observability/platform-tracing.ts` implements
this logic for tests and e2e smokes.

### Q3 — Operation performance summary

```sql
SELECT ssot__OperationName__c AS operation_name,
       AVG(ssot__DurationNumber__c) AS avg_duration_nanos,
       MAX(ssot__DurationNumber__c) AS max_duration_nanos,
       COUNT(*) AS span_count
FROM "ssot__TelemetryTraceSpan__dlm"
WHERE ssot__StartDateTime__c >= TIMESTAMP '2026-05-01 00:00:00'
GROUP BY ssot__OperationName__c
LIMIT 20
```

Avoid relying on `ORDER BY COUNT(*)` across Data Cloud SQL surfaces; sort the
small result client-side if needed.

### Q4 — Join STDM interaction context to Platform Tracing spans

Use this when you have a suspicious interaction and want the backend tree that
powered it:

```sql
SELECT i.ssot__Id__c AS interaction_id,
       i.ssot__AiAgentSessionId__c AS session_id,
       i.ssot__TopicApiName__c AS topic,
       i.ssot__StartTimestamp__c AS interaction_started,
       s.ssot__Id__c AS span_id,
       s.ssot__OperationName__c AS operation_name,
       s.ssot__TelemetryParentSpanId__c AS parent_span_id,
       s.ssot__StatusCode__c AS status_code,
       s.ssot__DurationNumber__c AS duration_nanos,
       s.ssot__StartDateTime__c AS span_started
FROM "ssot__AiAgentInteraction__dlm" i
JOIN "ssot__TelemetryTraceSpan__dlm" s
  ON s.ssot__TelemetryTrace__c = i.ssot__TelemetryTraceId__c
WHERE i.ssot__Id__c = '<interaction_id>'
ORDER BY s.ssot__StartDateTime__c ASC
LIMIT 500
```

If the join returns no spans, check whether Platform Tracing was enabled when
the interaction happened and whether Data Cloud ingestion has caught up.

## Closing the loop with sf-agentscript

Agent Platform Tracing is an observe surface. The fix still belongs in source:

1. Use `d360_api` to find the failing trace and summarize the span tree.
2. If conversational context matters, use STDM to recover the user utterance,
   topic, and step I/O.
3. Reproduce the utterance locally with `agentscript_preview` and deterministic
   `context_variables` when needed.
4. Fix the `.agent` file with `agentscript_mutate` or a targeted edit.
5. Run `agentscript_eval` to verify regressions.
6. Ship with `agentscript_lifecycle` when the fix is approved.

Do not patch generated org metadata as the fix. The `.agent` source and backing
logic remain the source of truth.
