# Agentforce session tracing (STDM)

When the user asks "why did agent X behave wrong yesterday?", "what's the
top intent in production?", or "which subagent has the most action errors
this week?" — that's a Data Cloud question. The Session Trace Data Model
(STDM) lands every published-agent conversation as a tree of DMO records;
this section is the field reference + copy-paste SQL.

For dev-loop / authoring questions (`.agent` source, preview, eval,
publish), the **sf-agentscript** skill owns the answer. STDM is for what
production users actually did.

## Pre-flight

- **Probe first.** STDM only writes when _Agentforce Activity_ data
  streams are turned on in the org. Run `d360_probe` and confirm Data
  Cloud is provisioned + active before any of the queries below.
- **Resolve the data space.** `d360_api GET /ssot/data-spaces` →
  filter `status: "Active"` → use `name` (typically `"default"`). Pass
  it as the `dataspaceName` query param to `/ssot/query-sql` calls.
- **Resolve the agent name.** STDM filters on `MasterLabel`
  (display name). It usually matches the `.agent` file's
  `config.label` but not always. When unsure:

  ```sql
  SELECT Id, MasterLabel, DeveloperName
  FROM GenAiPlannerDefinition
  WHERE MasterLabel LIKE '%<user-provided-name>%'
     OR DeveloperName LIKE '%<user-provided-name>%'
  ```

  (Standard SOQL; use `sf data query` or `d360_api` against the
  org's Tooling/REST). Note `DeveloperName` carries a `_vN` suffix
  (e.g. `OrderService_v9`); `--api-name` for `agentscript_lifecycle`
  drops the suffix (`OrderService`).

## DMO hierarchy (the 9 STDM DMOs you actually use)

```
ssot__AiAgentSession__dlm                    -- one row per session
├── ssot__AiAgentSessionParticipant__dlm     -- agent + user link rows
├── ssot__AiAgentInteraction__dlm            -- one row per turn
│   ├── ssot__AiAgentInteractionMessage__dlm -- user / agent text
│   └── ssot__AiAgentInteractionStep__dlm    -- LLM / action steps
└── ssot__AiAgentMoment__dlm                 -- intent groupings
    ├── ssot__AiAgentMomentInteraction__dlm  -- moment ↔ turn junction
    └── ssot__AiAgentTagAssociation__dlm     -- moment ↔ tag junction
        └── ssot__AiAgentTag__dlm            -- 1–5 quality score
```

Plus two optional Audit/Feedback DMOs that join on the step's
`ssot__GenerationId__c` / `ssot__GenAiGatewayRequestId__c`:

```
GenAIGeneration__dlm            -- responseText__c (full LLM response)
GenAIGatewayRequest__dlm        -- prompt__c (full prompt text)
```

These are only populated when _Einstein Audit & Feedback_ is enabled.

And one for RAG metrics:

```
ssot__AiRetrieverQualityMetric__dlm   -- faithfulness / relevancy / precision (0-1)
```

Empty when the agent has no knowledge-retrieval actions.

## Field reference (the fields you actually read)

| DMO                         | Field                                                            | What it is                                                                          |
| --------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `AiAgentSession`            | `ssot__Id__c`                                                    | session id                                                                          |
|                             | `ssot__StartTimestamp__c` / `ssot__EndTimestamp__c`              | window                                                                              |
|                             | `ssot__AiAgentChannelType__c`                                    | channel (`Builder: Voice Preview`, `Web`, `Messaging`, etc.)                        |
|                             | `ssot__AiAgentSessionEndType__c`                                 | `USER_ENDED` / `AGENT_ENDED` / null (in-progress or abandoned)                      |
|                             | `ssot__VariableText__c`                                          | final variable snapshot (JSON-ish text)                                             |
| `AiAgentSessionParticipant` | `ssot__AiAgentSessionId__c`                                      | session FK                                                                          |
|                             | `ssot__AiAgentApiName__c`                                        | **agent filter field** — primary STDM filter                                        |
|                             | `ssot__ParticipantId__c`                                         | `16j…` planner id (agent) or `005…` user id; **15-char OR 18-char inconsistently**  |
| `AiAgentInteraction`        | `ssot__TopicApiName__c`                                          | the subagent that handled the turn                                                  |
|                             | `ssot__StartTimestamp__c` / `ssot__EndTimestamp__c`              | turn window                                                                         |
|                             | `ssot__TelemetryTraceId__c`                                      | distributed-trace id                                                                |
| `AiAgentInteractionMessage` | `ssot__AiAgentInteractionMessageType__c`                         | `Input` (user) or `Output` (agent)                                                  |
|                             | `ssot__ContentText__c`                                           | message text                                                                        |
| `AiAgentInteractionStep`    | `ssot__AiAgentInteractionStepType__c`                            | `TOPIC_STEP` / `LLM_STEP` / `ACTION_STEP` / `SESSION_END` / `TRUST_GUARDRAILS_STEP` |
|                             | `ssot__Name__c`                                                  | step or action name                                                                 |
|                             | `ssot__ErrorMessageText__c`                                      | error string (null when clean)                                                      |
|                             | `ssot__InputValueText__c` / `ssot__OutputValueText__c`           | I/O payloads                                                                        |
|                             | `ssot__PreStepVariableText__c` / `ssot__PostStepVariableText__c` | variable snapshots around the step                                                  |
|                             | `ssot__GenerationId__c`                                          | join key to `GenAIGeneration__dlm` (LLM_STEP only)                                  |
|                             | `ssot__GenAiGatewayRequestId__c`                                 | join key to `GenAIGatewayRequest__dlm` (LLM_STEP only)                              |
| `AiAgentTagAssociation`     | `ssot__AssociationReasonText__c`                                 | LLM-generated reasoning for the quality score                                       |
|                             | `ssot__IsPassed__c`                                              | binary pass/fail on the moment                                                      |
|                             | `ssot__AiAgentTagId__c`                                          | join to `AiAgentTag.ssot__Value__c` for the 1–5 score                               |

## Quirks that bite

Five non-obvious behaviors. Knowing them up front saves an hour of
"why is my query empty?".

1. **`NOT_SET` sentinel.** Data Cloud writes the literal string
   `"NOT_SET"` for null/absent fields. Treat any field equal to
   `NOT_SET` as null. Your SQL needs explicit
   `WHERE field <> 'NOT_SET'` or post-process.
2. **`TRUST_GUARDRAILS_STEP.ssot__ErrorMessageText__c = "None"`** is
   not an error — it's the literal Python string. Filter to real errors
   with `step_type = 'ACTION_STEP' AND error_text IS NOT NULL AND error_text <> 'None'`.
3. **`LLM_STEP` `ssot__InputValueText__c` / `ssot__OutputValueText__c`
   are Python dict strings, not JSON.** Don't `JSON.parse()` them. Use
   regex extraction or join to `GenAIGeneration__dlm` /
   `GenAIGatewayRequest__dlm` for clean prompt + response text.
4. **15-char vs 18-char IDs.** `AiAgentSessionParticipant.ssot__ParticipantId__c`
   stores both formats inconsistently for the same record. When filtering
   by planner id, query both forms or use `LIKE 'ABC%'` on the prefix.
5. **Preview / eval runs leak into Session but not Interaction.**
   Sessions started by `agentscript_preview` or `agentscript_eval`
   write a row to `AiAgentSession__dlm` but never produce a child
   `AiAgentInteraction__dlm` row. If you want production traffic only,
   `INNER JOIN` Interaction in your filter — it silently drops the
   dev/test runs. If your query returns zero rows but the agent IS
   being used, the cause is usually too-tight time window or
   participant-id format mismatch (see quirk #4), not missing data.

Plus the propagation lag: STDM is eventually consistent. Sessions land
~30 min – 2 h after they end (verified empirically). Don't query for
"the session I just finished" and conclude the API is broken.

## Three queries that cover ~80% of agent observability work

Every query goes through `d360_api POST /ssot/query-sql` with body
`{ "sql": "...", "dataspaceName": "<name>" }`. Quote DMO names with
double quotes; that's Data Cloud SQL grammar (different from SOQL).

### Q1 — Find recent sessions for an agent

```sql
SELECT DISTINCT
  s.ssot__Id__c                         AS session_id,
  s.ssot__StartTimestamp__c             AS started,
  s.ssot__EndTimestamp__c               AS ended,
  s.ssot__AiAgentChannelType__c         AS channel,
  s.ssot__AiAgentSessionEndType__c      AS end_type
FROM "ssot__AiAgentSession__dlm" s
JOIN "ssot__AiAgentSessionParticipant__dlm" p
  ON p.ssot__AiAgentSessionId__c = s.ssot__Id__c
WHERE p.ssot__AiAgentApiName__c = '<MasterLabel>'
  AND s.ssot__StartTimestamp__c >= TIMESTAMP '2026-05-01 00:00:00'
ORDER BY s.ssot__StartTimestamp__c DESC
LIMIT 50
```

`DISTINCT` is required. Each session has 2–3 participant rows (agent +
user + sometimes a system actor) and the JOIN duplicates the session
row once per participant. Without DISTINCT you get the same
`session_id` back N times.

If this returns zero rows but the agent IS being used, fall back to the
planner-id path: query `GenAiPlannerDefinition` for the
`MasterLabel`, then filter on `p.ssot__ParticipantId__c IN ('<id>','<18char>')`.

### Q2 — Pull the conversation timeline for one session

```sql
SELECT
  i.ssot__StartTimestamp__c             AS turn_started,
  i.ssot__TopicApiName__c               AS topic,
  m.ssot__AiAgentInteractionMessageType__c AS who,
  m.ssot__ContentText__c                AS text
FROM "ssot__AiAgentInteraction__dlm" i
LEFT JOIN "ssot__AiAgentInteractionMessage__dlm" m
  ON m.ssot__AiAgentInteractionId__c = i.ssot__Id__c
WHERE i.ssot__AiAgentSessionId__c = '<session_id>'
ORDER BY i.ssot__StartTimestamp__c, m.ssot__MessageSentTimestamp__c
```

The message DMO orders on `ssot__MessageSentTimestamp__c`, NOT
`ssot__StartTimestamp__c` (that field doesn't exist on the message
DMO and the query 400s with `unknown column`). The interaction DMO
uses `StartTimestamp__c`; the message DMO uses `MessageSentTimestamp__c`.
Different DMOs, different naming.

For the LLM/action steps inside each turn, swap the message join for
`ssot__AiAgentInteractionStep__dlm` and read
`ssot__AiAgentInteractionStepType__c`, `ssot__Name__c`,
`ssot__ErrorMessageText__c`, `ssot__InputValueText__c`,
`ssot__OutputValueText__c`.

### Q3 — Aggregate metrics: subagent routing distribution

```sql
SELECT
  i.ssot__TopicApiName__c               AS subagent,
  COUNT(*)                              AS turn_count,
  AVG(EXTRACT(EPOCH FROM (i.ssot__EndTimestamp__c - i.ssot__StartTimestamp__c))) AS avg_seconds
FROM "ssot__AiAgentInteraction__dlm" i
JOIN "ssot__AiAgentSession__dlm" s ON s.ssot__Id__c = i.ssot__AiAgentSessionId__c
JOIN "ssot__AiAgentSessionParticipant__dlm" p ON p.ssot__AiAgentSessionId__c = s.ssot__Id__c
WHERE p.ssot__AiAgentApiName__c = '<MasterLabel>'
  AND i.ssot__StartTimestamp__c >= TIMESTAMP '2026-05-01 00:00:00'
GROUP BY i.ssot__TopicApiName__c
ORDER BY turn_count DESC
```

Variants worth keeping in your back pocket:

- **Action error rate** — group by `s.ssot__Name__c` on
  `ssot__AiAgentInteractionStep__dlm` filtered to `step_type = 'ACTION_STEP'`
  AND `error_text IS NOT NULL AND error_text <> 'None'`.
- **Abandoned-session rate** — `WHERE s.ssot__AiAgentSessionEndType__c IS NULL`
  / `total sessions`.
- **LOW-adherence rate** — filter `step_type = 'TRUST_GUARDRAILS_STEP'`,
  search for `'value': 'LOW'` in `ssot__OutputValueText__c`.

## RAG quality (only when the agent uses retrieval actions)

Three numeric quality metrics 0–1, written per knowledge retrieval:

```sql
SELECT
  rqm.ssot__RetrieverApiName__c               AS retriever,
  rqm.ssot__UserUtteranceText__c              AS utterance,
  rqm.ssot__FaithfulnessRelevancyScoreNumber__c AS faithfulness,
  rqm.ssot__AnswerRelevancyScoreNumber__c       AS answer_relevancy,
  rqm.ssot__ContextPrecisionScoreNumber__c      AS context_precision
FROM "ssot__AiRetrieverQualityMetric__dlm" rqm
WHERE rqm.ssot__StartTimestamp__c >= TIMESTAMP '2026-05-01 00:00:00'
ORDER BY rqm.ssot__FaithfulnessRelevancyScoreNumber__c ASC
LIMIT 50
```

Low faithfulness with high answer*relevancy = the agent is making things
up that \_sound* relevant — usually means the retrieval surface is
returning thin context and the LLM is filling gaps from training data.
Fix is upstream: enrich the knowledge base, tighten the retriever's
filters, or scope the action's `available when:` so it doesn't fire on
queries the KB can't answer.

## Closing the loop with sf-agentscript

After STDM surfaces a problem, the next action is usually:

1. Identify the failing utterance (`messages.text` in Q2).
2. Reproduce in preview against the local source:

   ```
   agentscript_preview action='start' agent_file=…/<Bot>.agent
   agentscript_preview action='send' agent_name=… session_id=… \
     message='<the production utterance>' \
     context_variables=[…production-shaped seeds…]
   ```

3. Read the local trace, fix `.agent`, regression-eval, ship.

Fix in `.agent`, not in metadata directly. The agent file is the single
source of truth; everything else is derived.
