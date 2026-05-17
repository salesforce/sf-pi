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
    expect(text).toContain("Agent Observability");
    expect(text).toContain("📄 Full JSON: /tmp/pi-d360-search/output.json");
    expect(text).not.toContain('"results"');
  });

  it("summarizes examples shape", () => {
    const card = facadeResultToCard({
      ok: true,
      action: "examples",
      summary: "Example for d360_query_sql",
      operation: {
        name: "d360_query_sql",
        requiredParams: ["sql"],
        optionalParams: ["dataspaceName"],
      },
    });

    expect(card.title).toBe("Data 360 examples");
    expect(card.sections?.[0]?.lines).toContain("Required: sql");
    expect(card.sections?.[0]?.lines).toContain("Optional: dataspaceName");
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

  it("summarizes STDM timeline runbooks", () => {
    const { text } = facadeResultToLlmText(
      {
        ok: true,
        action: "runbook",
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
      { fullOutputPath: "/tmp/pi-d360-runbook/output.json" },
    );

    expect(text).toContain("💬 STDM session timeline ✅");
    expect(text).toContain("Rows: 8");
    expect(text).toContain("👤 Hi! What is Agent Script?");
    expect(text).toContain("📄 Full JSON: /tmp/pi-d360-runbook/output.json");
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
        operations: [],
        runbooks: ["agent_observability.stdm_session_timeline"],
      },
    ],
  };
}
