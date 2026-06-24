/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { presentData360Result } from "../lib/v2/result-presenter.ts";

type PresentedDetails = {
  digest: { artifacts: Array<{ path: string; kind: string }> };
  card: { artifacts?: Array<{ path: string; kind: string }> };
  sfPi: { data: { digest: unknown; card: unknown } };
};

const baseInput = {
  tool: "data360_observe" as const,
  target_org: "AgentforceSTDM",
};

describe("Data 360 v2 result presenter", () => {
  it("builds readiness summaries with surface counts and key probe states", async () => {
    const presented = await presentData360Result(
      {
        tool: "data360_discover",
        action: "readiness.probe",
        target_org: "AgentforceSTDM",
      },
      {
        ok: true,
        tool: "data360_discover",
        action: "readiness.probe",
        targetOrg: "AgentforceSTDM",
        apiVersion: "67.0",
        state: "partial",
        guidance:
          "Core Data 360 surfaces are reachable, but some optional surfaces are unavailable.",
        probes: [
          { name: "data_spaces", path: "/ssot/data-spaces", state: "enabled_populated", count: 1 },
          {
            name: "dmo_catalog",
            path: "/ssot/data-model-objects?limit=1",
            state: "enabled_populated",
            count: 1,
          },
          {
            name: "agent_platform_tracing_dlo",
            path: "/ssot/data-lake-objects/ObservabilitySpans__dll",
            state: "feature_gated",
            message: "This feature is not currently enabled.",
          },
        ],
        summary: "Data 360 readiness: partial",
      },
      "summary",
    );

    expect(presented.content[0]?.text).toContain("Data 360 readiness: partial");
    expect(presented.content[0]?.text).toContain("Ready surfaces: 2");
    expect(presented.content[0]?.text).toContain("Problem surfaces: 1");
    expect(presented.content[0]?.text).not.toContain("OTel resource spans: 2");
    expect(presented.content[0]?.text).not.toContain("Failures: 1");
    expect(presented.content[0]?.text).toContain("Core Data 360: 2/2 ready");
    expect(presented.content[0]?.text).toContain("Observe: 0/1 ready");
    expect(presented.content[0]?.text).toContain("Agent Platform Tracing: feature_gated");
    expect(presented.content[0]?.text).toContain(
      "Enable or grant access to Agent Platform Tracing",
    );
    const details = presented.details as PresentedDetails;
    expect(details.digest).toMatchObject({
      source: "readiness",
      stats: { steps: 3, failed: 1, warnings: 1 },
    });
    expect(details.digest.artifacts.map((artifact) => artifact.path)).toEqual(
      expect.arrayContaining([expect.stringContaining("readiness.json")]),
    );
  });

  it("builds a semantic Run Digest and Result Card for STDM session search", async () => {
    const presented = await presentData360Result(
      {
        ...baseInput,
        action: "stdm.find_sessions",
        params: { since: "2026-06-23", limit: 2 },
      },
      {
        ok: true,
        tool: "data360_observe",
        action: "stdm.find_sessions",
        requestedAction: "stdm.find_sessions",
        targetOrg: "AgentforceSTDM",
        apiVersion: "67.0",
        dataspaceName: "default",
        capability: "agent_observability.stdm_find_sessions",
        runbook: "agent_observability.stdm_find_sessions",
        result: {
          sql: "SELECT session_id FROM sessions LIMIT 2",
          data: {
            rowCount: 2,
            rows: [
              {
                session_id: "session-1",
                agent_api_name: "DemoAgent",
                started: "2026-06-23T00:00:00Z",
                channel: "Web",
                interaction_count: 3,
              },
              {
                session_id: "session-2",
                agent_api_name: "DemoAgent",
                started: "2026-06-23T00:05:00Z",
                channel: "SIP",
                interaction_count: 8,
              },
            ],
          },
          markdown: "🔎 STDM sessions: 2",
        },
        summary: "🔎 STDM sessions: 2",
      },
      "summary",
    );

    expect(presented.content[0]?.text).toContain("Data 360 Run Digest");
    expect(presented.content[0]?.text).toContain("stdm.find_sessions");
    expect(presented.content[0]?.text).toContain("Rows: 2");
    expect(presented.content[0]?.text).toContain("session-1");
    const details = presented.details as PresentedDetails;
    expect(details.digest).toMatchObject({
      source: "runbook",
      tool: "data360_observe",
      action: "stdm.find_sessions",
      stats: { rows: 2 },
    });
    expect(details.card).toMatchObject({
      title: "Data 360 Observe",
      summary: "🔎 STDM sessions: 2",
    });
    expect(details.sfPi.data.digest).toBeDefined();
    expect(details.sfPi.data.card).toBeDefined();
    const artifacts = details.digest.artifacts;
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining(["json", "sql"]),
    );
    expect(artifacts.every((artifact) => existsSync(artifact.path))).toBe(true);
  });

  it("summarizes OTel exports without putting raw ResourceSpans in model context", async () => {
    const presented = await presentData360Result(
      {
        ...baseInput,
        action: "stdm.session_otel",
        params: { session_id: "session-1" },
      },
      {
        ok: true,
        tool: "data360_observe",
        action: "stdm.session_otel",
        targetOrg: "AgentforceSTDM",
        apiVersion: "67.0",
        status: 200,
        request: { method: "GET", path: "/services/data/v67.0/einstein/audit/otel/session-1" },
        response: {
          resourceSpans: [
            {
              resource: {},
              scopeSpans: [
                {
                  spans: [
                    { name: "run.interaction", status: { code: "STATUS_CODE_OK" } },
                    { name: "run.action.Lookup", status: { code: "STATUS_CODE_ERROR" } },
                  ],
                },
              ],
            },
          ],
        },
        summary: "Agentforce Session Trace OTel export HTTP 200",
      },
      "summary",
    );

    expect(presented.content[0]?.text).toContain("OTel resource spans: 1");
    expect(presented.content[0]?.text).toContain("OTel spans: 2");
    expect(presented.content[0]?.text).toContain("Errors: 1");
    expect(presented.content[0]?.text).not.toContain("scopeSpans");
    const details = presented.details as PresentedDetails;
    expect(details.digest).toMatchObject({
      source: "local",
      stats: { resources: 1, steps: 2, failed: 1 },
    });
  });

  it("deduplicates adjacent repeated STDM timeline preview rows", async () => {
    const presented = await presentData360Result(
      {
        ...baseInput,
        action: "stdm.session_timeline",
        params: { session_id: "session-1" },
      },
      {
        ok: true,
        tool: "data360_observe",
        action: "stdm.session_timeline",
        targetOrg: "AgentforceSTDM",
        dataspaceName: "default",
        runbook: "agent_observability.stdm_session_timeline",
        result: {
          sql: "SELECT messages FROM timeline",
          data: {
            rowCount: 4,
            rows: [
              { who: "Output", topic: "Greeting", text: "Hello there" },
              { who: "Output", topic: "Greeting", text: "Hello there" },
              { who: "Input", topic: "Greeting", text: "I need help" },
              { who: "Input", topic: "Greeting", text: "I need help" },
            ],
          },
          markdown: "💬 STDM session timeline session-1",
        },
        summary: "💬 STDM session timeline session-1",
      },
      "summary",
    );

    expect(presented.content[0]?.text).toContain("Rows: 4");
    expect(presented.content[0]?.text).toContain("Agent · Greeting: Hello there");
    expect(presented.content[0]?.text).toContain("User · Greeting: I need help");
    expect(presented.content[0]?.text).toContain("2 adjacent duplicate timeline rows hidden");
  });

  it("builds trace tree summaries with span stats and Markdown artifacts", async () => {
    const presented = await presentData360Result(
      {
        ...baseInput,
        action: "trace.trace_tree",
        params: { trace_id: "trace-1" },
      },
      {
        ok: true,
        tool: "data360_observe",
        action: "trace.trace_tree",
        targetOrg: "AgentforceSTDM",
        dataspaceName: "default",
        runbook: "agent_observability.platform_trace_tree",
        result: {
          sql: "SELECT * FROM trace WHERE id = 'trace-1'",
          data: {
            summary: { totalSpans: 3, errorCount: 1, maxDepth: 2 },
            rows: [{ span_id: "root" }, { span_id: "child" }, { span_id: "error" }],
          },
          markdown:
            "🌳 Platform trace trace-1\n   spans=3 roots=1 errors=1 maxDepth=2\n🔴 run.action.Lookup — 12ms",
        },
        summary: "🌳 Platform trace trace-1",
      },
      "summary",
    );

    expect(presented.content[0]?.text).toContain("Spans: 3");
    expect(presented.content[0]?.text).toContain("Errors: 1");
    expect(presented.content[0]?.text).toContain("run.action.Lookup");
    const details = presented.details as PresentedDetails;
    expect(details.digest.artifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining(["json", "sql", "markdown"]),
    );
  });

  it("keeps small local catalog actions artifact-free", async () => {
    const presented = await presentData360Result(
      {
        tool: "data360_observe",
        action: "action.describe",
        params: { action: "trace.error_traces" },
      },
      {
        ok: true,
        tool: "data360_observe",
        action: "action.describe",
        requestedAction: "trace.error_traces",
        summary:
          "data360_observe trace.error_traces: Find recent Agent Platform Tracing ERROR spans.",
      },
      "summary",
    );

    expect(presented.content[0]?.text).toContain("action.describe");
    const details = presented.details as PresentedDetails;
    expect(details.digest.artifacts).toEqual([]);
    expect(details.card.artifacts).toBeUndefined();
  });
});
