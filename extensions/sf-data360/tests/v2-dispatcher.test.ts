/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();
const requestMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import { clearConnectionCache } from "../../../lib/common/sf-conn/connection.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { runData360V2Action } from "../lib/v2/dispatcher.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.136.8" },
  project: { detected: true, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: true, targetOrg: "AgentforceSTDM", location: "Global" },
  org: {
    detected: true,
    alias: "AgentforceSTDM",
    username: "agentforce@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "67.0",
  },
  detectedAt: 1,
};

const ctx = { hasUI: false } as never;

describe("Data 360 v2 dispatcher", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("describes the endpoint behind an action without a network call", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "action.describe",
        params: { action: "stream.create_ingest_api" },
        target_org: "AgentforceSTDM",
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_prepare",
      action: "action.describe",
      requestedAction: "stream.create_ingest_api",
      match: expect.objectContaining({
        capability: "d360_datastream_create_ingest_api",
        endpoint: { method: "POST", path: "/ssot/data-streams" },
      }),
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  it("dry-runs a source schema test through the existing REST execution path", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "source_schema.test",
        params: {
          connectionId: "1WM000000000000AAA",
          body: { schemas: [{ name: "DemoObject", label: "DemoObject", schemaType: "IngestApi" }] },
        },
        target_org: "AgentforceSTDM",
        dry_run: true,
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_connect",
      action: "source_schema.test",
      capability: "d360_ingest_api_schema_test",
      dryRun: true,
      targetOrg: "AgentforceSTDM",
      request: {
        method: "POST",
        path: "/services/data/v67.0/ssot/connections/1WM000000000000AAA/schema/actions/test",
        body: expect.objectContaining({ schemas: expect.any(Array) }),
      },
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  it("searches the cross-family catalog through data360_discover", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "catalog.search",
        params: { query: "ingestion api stream" },
        target_org: "AgentforceSTDM",
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_discover",
      action: "catalog.search",
      query: "ingestion api stream",
    });
    expect(result.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_prepare", action: "stream.create_ingest_api" }),
      ]),
    );
  });

  it("describes any v2 action through data360_discover catalog.action", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "catalog.action",
        params: { tool: "data360_prepare", action: "stream.create_ingest_api" },
        target_org: "AgentforceSTDM",
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_discover",
      action: "catalog.action",
      match: expect.objectContaining({
        tool: "data360_prepare",
        action: "stream.create_ingest_api",
        endpoint: { method: "POST", path: "/ssot/data-streams" },
      }),
    });
  });

  it("resolves examples by v2 tool/action through data360_discover", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "examples.get",
        params: { tool: "data360_prepare", action: "stream.create_ingest_api" },
        target_org: "AgentforceSTDM",
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_discover",
      action: "stream.create_ingest_api",
      capability: "d360_datastream_create_ingest_api",
      example: expect.objectContaining({ capability: "d360_datastream_create_ingest_api" }),
    });
  });

  it("dry-runs raw REST through data360_api rest.request", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_api",
        action: "rest.request",
        params: { method: "GET", path: "/ssot/data-streams", query: { limit: 1 } },
        target_org: "AgentforceSTDM",
        dry_run: true,
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_api",
      action: "rest.request",
      dryRun: true,
      targetOrg: "AgentforceSTDM",
      request: {
        method: "GET",
        path: "/services/data/v67.0/ssot/data-streams?limit=1",
        body: null,
      },
      safety: { level: "read", requiresConfirmation: false },
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  it("dry-runs Data 360 readiness probes through data360_discover", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "readiness.probe",
        target_org: "AgentforceSTDM",
        dry_run: true,
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_discover",
      action: "readiness.probe",
      dryRun: true,
      targetOrg: "AgentforceSTDM",
      apiVersion: "67.0",
    });
    expect(result.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "data_spaces",
          path: "/services/data/v67.0/ssot/data-spaces",
        }),
      ]),
    );
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  it("exports a known Agentforce session through the OTel API", async () => {
    requestMock.mockResolvedValue({ resourceSpans: [{ scopeSpans: [] }] });

    const result = await runData360V2Action(
      {
        tool: "data360_observe",
        action: "stdm.session_otel",
        target_org: "AgentforceSTDM",
        params: { session_id: "session-1" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_observe",
      action: "stdm.session_otel",
      status: 200,
      response: { resourceSpans: expect.any(Array) },
      summary: "Agentforce Session Trace OTel export HTTP 200",
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "/services/data/v67.0/einstein/audit/otel/session-1",
      }),
    );
  });

  it("dry-runs Agentforce Session Trace OTel export", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_observe",
        action: "stdm.session_otel",
        target_org: "AgentforceSTDM",
        dry_run: true,
        params: { session_id: "session/with space" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_observe",
      action: "stdm.session_otel",
      dryRun: true,
      request: {
        method: "GET",
        path: "/services/data/v67.0/einstein/audit/otel/session%2Fwith%20space",
      },
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  it("emits lightweight progress for runbook-backed observe actions", async () => {
    requestMock.mockResolvedValue({
      metadata: [{ name: "ssot__Id__c" }],
      data: [["span-1"]],
    });
    const progress: Array<{ stage: string; status: string }> = [];

    await runData360V2Action(
      {
        tool: "data360_observe",
        action: "trace.error_traces",
        target_org: "AgentforceSTDM",
        params: { since: "2026-06-23", limit: 1 },
      },
      env,
      ctx,
      undefined,
      (event) => progress.push(event),
    );

    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "execute", status: "running" }),
        expect.objectContaining({ stage: "summarize", status: "success" }),
      ]),
    );
  });

  it("finds STDM sessions through a runbook-backed observe action", async () => {
    requestMock.mockResolvedValue({
      metadata: [
        { name: "session_id" },
        { name: "started" },
        { name: "ended" },
        { name: "channel" },
        { name: "end_type" },
        { name: "agent_api_name" },
        { name: "interaction_count" },
      ],
      data: [["session-1", "start", "end", "Web", "USER_ENDED", "DemoAgent", 2]],
    });

    const result = await runData360V2Action(
      {
        tool: "data360_observe",
        action: "stdm.find_sessions",
        target_org: "AgentforceSTDM",
        params: { agent_api_name: "DemoAgent", since: "2026-06-23", limit: 5 },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_observe",
      action: "stdm.find_sessions",
      capability: "agent_observability.stdm_find_sessions",
      summary: "🔎 STDM sessions: 1",
    });
  });

  it("emits per-probe readiness progress", async () => {
    requestMock.mockResolvedValue({ totalSize: 1, data: [{ id: "ok" }] });
    const progress: Array<{ stage: string; status: string; message: string }> = [];

    await runData360V2Action(
      {
        tool: "data360_discover",
        action: "readiness.probe",
        target_org: "AgentforceSTDM",
        timeout_ms: 10,
      },
      env,
      ctx,
      undefined,
      (event) => progress.push(event),
    );

    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "execute", status: "running" }),
        expect.objectContaining({
          stage: "execute",
          status: "success",
          message: expect.stringContaining("data_spaces"),
        }),
        expect.objectContaining({
          stage: "execute",
          status: "success",
          message: expect.stringContaining("agent_platform_tracing_dlo"),
        }),
        expect.objectContaining({ stage: "summarize", status: "success" }),
      ]),
    );
  });

  it("returns partial readiness when one probe times out", async () => {
    let call = 0;
    requestMock.mockImplementation(async () => {
      call += 1;
      if (call === 1) return new Promise(() => undefined);
      return { totalSize: 1, data: [{ id: "ok" }] };
    });

    const result = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "readiness.probe",
        target_org: "AgentforceSTDM",
        timeout_ms: 1,
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_discover",
      action: "readiness.probe",
      targetOrg: "AgentforceSTDM",
      state: "partial",
    });
    expect(result.probes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "data_spaces",
          state: "cli_error",
          message: expect.stringContaining("timed out"),
        }),
      ]),
    );
  });

  it("emits per-step progress for journey runs", async () => {
    requestMock.mockResolvedValue({ id: "ok", name: "ok" });
    const progress: Array<{ stage: string; status: string; message: string }> = [];

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "semantic_retrieval.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: {
          searchIndexBody: { name: "DemoIndex" },
          retrieverBody: { name: "DemoRetriever" },
        },
      },
      env,
      ctx,
      undefined,
      (event) => progress.push(event),
    );

    expect(result).toMatchObject({ ok: true, action: "semantic_retrieval.run" });
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "execute",
          status: "running",
          message: expect.stringContaining("Step 1/2 data360_semantic search_index.create"),
        }),
        expect.objectContaining({
          stage: "execute",
          status: "success",
          message: expect.stringContaining("Step 1/2 data360_semantic search_index.create"),
        }),
        expect.objectContaining({
          stage: "execute",
          status: "running",
          message: expect.stringContaining("Step 2/2 data360_semantic retriever.create"),
        }),
      ]),
    );
  });

  it("executes sql.verify_rows through Data 360 Query SQL", async () => {
    requestMock.mockResolvedValue({
      data: [[3]],
      metadata: [{ name: "row_count" }],
      returnedRows: 1,
    });

    const result = await runData360V2Action(
      {
        tool: "data360_query",
        action: "sql.verify_rows",
        target_org: "AgentforceSTDM",
        params: { dloName: "DemoStream__dll" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_query",
      action: "sql.verify_rows",
      status: 200,
      response: { data: [[3]] },
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/services/data/v67.0/ssot/query-sql?dataspaceName=default",
        body: JSON.stringify({ sql: "SELECT COUNT(*) AS row_count FROM DemoStream__dll" }),
      }),
    );
  });

  it("plans Route A CSV ingestion as explicit phase actions without mutating", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "ingest_csv.plan",
        params: {
          sourceName: "DemoSource",
          schemaObjectName: "DemoObject",
          streamName: "DemoStream",
          csvPath: "data/demo.csv",
        },
        target_org: "AgentforceSTDM",
        dry_run: true,
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_orchestrate",
      action: "ingest_csv.plan",
      targetOrg: "AgentforceSTDM",
      dryRun: true,
      summary: expect.stringContaining("Route A"),
    });
    expect(result.steps).toEqual([
      expect.objectContaining({ tool: "data360_discover", action: "readiness.probe" }),
      expect.objectContaining({ tool: "data360_connect", action: "source_schema.test" }),
      expect.objectContaining({ tool: "data360_connect", action: "source_schema.put" }),
      expect.objectContaining({ tool: "data360_prepare", action: "stream.create_ingest_api" }),
      expect.objectContaining({ tool: "data360_prepare", action: "ingest_job.create" }),
      expect.objectContaining({ tool: "data360_prepare", action: "ingest_job.upload_csv" }),
      expect.objectContaining({ tool: "data360_prepare", action: "ingest_job.close" }),
      expect.objectContaining({ tool: "data360_prepare", action: "ingest_job.poll" }),
      expect.objectContaining({ tool: "data360_query", action: "sql.verify_rows" }),
    ]);
    expect(orgCreateMock).not.toHaveBeenCalled();
  });
});
