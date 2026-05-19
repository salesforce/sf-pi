/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { facadeResultToCard, facadeResultToLlmText } from "../lib/display/facade-card.ts";

describe("d360 facade result cards", () => {
  it("summarizes search results without raw JSON", () => {
    const { card, text } = facadeResultToLlmText(searchResult(), {
      fullOutputPath: "/tmp/pi-d360-search/output.json",
    });

    expect(card.title).toBe("Data 360 search");
    expect(text).toContain("💠 Data 360 search ✅");
    expect(text).toContain("Stage 2/5: Discover");
    expect(text).toContain("Agent Observability");
    expect(text).toContain("capabilities");
    expect(text).toContain("📄 Full JSON: /tmp/pi-d360-search/output.json");
    expect(text).not.toContain('"results"');
  });

  it("summarizes capability example shapes", () => {
    const card = facadeResultToCard({
      ok: true,
      action: "examples",
      summary: "Example for d360_query_sql",
      capability: {
        name: "d360_query_sql",
        kind: "rest_operation",
        requiredParams: ["sql"],
        optionalParams: ["dataspaceName"],
      },
    });

    expect(card.title).toBe("Data 360 examples");
    expect(card.subtitle).toBe("d360_query_sql");
    expect(card.sections?.[0]?.lines).toContain("Required: sql");
    expect(card.sections?.[0]?.lines).toContain("Optional: dataspaceName");
    expect(card.nextSteps).toEqual(["Use d360 execute with this capability and params."]);
  });

  it("extracts scalar query results from execute responses", () => {
    const { text } = facadeResultToLlmText({
      ok: true,
      action: "execute",
      targetOrg: "AgentforceSTDM",
      operation: "d360_query_sql",
      status: 200,
      summary: "d360_query_sql HTTP 200",
      response: {
        data: [[119]],
        metadata: [{ name: "n" }],
      },
    });

    expect(text).toContain("💠 Data 360 execute ✅");
    expect(text).toContain("Stage 5/5: Summarize");
    expect(text).toContain("n = 119");
  });

  it("extracts primary error messages from execute failures", () => {
    const { card, text } = facadeResultToLlmText({
      ok: false,
      action: "execute",
      targetOrg: "AgentforceSTDM",
      operation: "d360_query_sql",
      status: 500,
      response: {
        errorCode: "BAD_REQUEST",
        message: JSON.stringify({
          primaryMessage: 'table "ssot__TelemetryTraceSpan__dlm" does not exist',
        }),
      },
    });

    expect(card.status).toBe("error");
    expect(text).toContain("BAD_REQUEST");
    expect(text).toContain('table "ssot__TelemetryTraceSpan__dlm" does not exist');
  });

  it("extracts nested application errors from HTTP 200 responses", () => {
    const { card, text } = facadeResultToLlmText({
      ok: false,
      action: "execute",
      targetOrg: "AgentforceSTDM",
      operation: "d360_metadata_search",
      status: 200,
      response: {
        content: [],
        error: {
          type: "PRISM_RUNTIME_ERROR",
          message:
            'Failed to execute hybrid search. Error: INVALID_ARGUMENT: table "msr_metadata_index__dlm" does not exist',
        },
        size: 0,
      },
    });

    expect(card.status).toBe("error");
    expect(text).toContain("PRISM_RUNTIME_ERROR");
    expect(text).toContain('table "msr_metadata_index__dlm" does not exist');
    expect(text).not.toContain("Keys: content, error, size");
  });

  it("summarizes local helper output and next steps", () => {
    const { card, text } = facadeResultToLlmText({
      ok: true,
      action: "execute",
      targetOrg: "AgentforceSTDM",
      operation: "d360_smart_mapping_suggest",
      helper: "d360_smart_mapping_suggest",
      summary: "Suggested 2 DLO-to-DMO field mapping(s)",
      matchCount: 2,
      matches: [
        { sourceField: "Id__c", targetField: "Id__c", confidence: 1 },
        { sourceField: "Name__c", targetField: "Name__c", confidence: 1 },
      ],
      next: {
        operation: "d360_dmo_mapping_create",
        dry_run: true,
        hint: "Review mappingPayload, then dry-run d360_dmo_mapping_create.",
      },
    });

    expect(card.sections?.[0]?.title).toBe("Suggested mappings");
    expect(text).toContain("Matches: 2");
    expect(text).toContain("High confidence: 2");
    expect(text).toContain("Next: d360_dmo_mapping_create dry_run");
  });

  it("summarizes destructive preflight failures", () => {
    const { text } = facadeResultToLlmText({
      ok: false,
      action: "execute",
      targetOrg: "AgentforceSTDM",
      operation: "d360_dmo_delete",
      status: 404,
      summary: "d360_dmo_delete preflight failed HTTP 404",
      error: "Destructive operation blocked because its read preflight failed.",
      preflight: {
        method: "GET",
        path: "/services/data/v66.0/ssot/data-model-objects/Missing__dlm",
      },
      response: {
        errorCode: "NOT_FOUND",
        message: "not found",
      },
    });

    expect(text).toContain("🛡️ Preflight");
    expect(text).toContain("GET /services/data/v66.0/ssot/data-model-objects/Missing__dlm");
    expect(text).toContain("NOT_FOUND");
  });

  it("summarizes runbook-backed capabilities executed through d360 execute", () => {
    const { text } = facadeResultToLlmText(
      {
        ok: true,
        action: "execute",
        capability: "agent_observability.stdm_session_timeline",
        capabilityKind: "runbook",
        targetOrg: "AgentforceSTDM",
        dataspaceName: "default",
        runbook: "agent_observability.stdm_session_timeline",
        summary: "💬 STDM session timeline 019e2218",
        result: {
          data: { rowCount: 8 },
          markdown: [
            "💬 STDM session timeline 019e2218",
            "   👤 Hi! What is Agent Script?",
            "   🤖 Hi, I'm an AI assistant. How can I help you?",
          ].join("\n"),
        },
      },
      { fullOutputPath: "/tmp/pi-d360-capability/output.json" },
    );

    expect(text).toContain("💬 STDM session timeline ✅");
    expect(text).toContain("Stage 5/5: Summarize");
    expect(text).toContain("ssot__AiAgentInteraction__dlm");
    expect(text).toContain("Rows: 8");
    expect(text).toContain("1. 👤 User");
    expect(text).toContain("Hi! What is Agent Script?");
    expect(text).toContain("📄 Full JSON: /tmp/pi-d360-capability/output.json");
  });
});

function searchResult() {
  return {
    ok: true,
    action: "search",
    query: "agent observability",
    summary: "1 Data 360 family match(es)",
    results: [
      {
        family: "Agent Observability",
        capabilities: [
          { name: "agent_observability.stdm_session_timeline", kind: "runbook", safety: "read" },
        ],
      },
    ],
  };
}
