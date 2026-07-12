/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

describe("Data 360 v2 execute parity across action kinds", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("executes representative read REST actions", async () => {
    requestMock.mockResolvedValue({ dataStreams: [] });

    const result = await runData360V2Action(
      { tool: "data360_prepare", action: "stream.list", target_org: "AgentforceSTDM" },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "stream.list",
      capability: "d360_datastream_list",
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", url: "/services/data/v67.0/ssot/data-streams" }),
    );
  });

  it("executes representative safe_post REST actions", async () => {
    requestMock.mockResolvedValue({ data: [[1]], metadata: [{ name: "row_count" }] });

    const result = await runData360V2Action(
      {
        tool: "data360_query",
        action: "sql.run",
        target_org: "AgentforceSTDM",
        params: { sql: "SELECT 1" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: true, action: "sql.run", capability: "d360_query_sql" });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", url: "/services/data/v67.0/ssot/query-sql" }),
    );
  });

  it("executes newly imported safe_post helper actions", async () => {
    requestMock.mockResolvedValue({ fields: [] });

    const result = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "connection.object_fields.describe",
        target_org: "AgentforceSTDM",
        params: {
          connectionId: "example-connection-id",
          resourceName: "CUSTOMER",
          body: { advancedAttributes: '{"database":"EXAMPLE_DB"}' },
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "connection.object_fields.describe",
      capability: "d360_connection_object_fields_describe",
      safety: "safe_post",
    });
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        url: "/services/data/v67.0/ssot/connections/example-connection-id/objects/CUSTOMER/fields",
      }),
    );
  });

  it("dry-runs representative confirmed REST actions", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "stream.create",
        target_org: "AgentforceSTDM",
        dry_run: true,
        params: { body: { name: "Demo" } },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "stream.create",
      dryRun: true,
      safety: "confirmed",
      request: { method: "POST", path: "/services/data/v67.0/ssot/data-streams" },
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });

  it("dry-runs newly imported ML and personalization actions", async () => {
    await expect(
      runData360V2Action(
        {
          tool: "data360_semantic",
          action: "ml.prediction_job_def.create_regression",
          target_org: "AgentforceSTDM",
          dry_run: true,
          params: { body: { name: "SfPiParity_Regression" } },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({
      ok: true,
      action: "ml.prediction_job_def.create_regression",
      safety: "confirmed",
      request: {
        method: "POST",
        path: "/services/data/v67.0/ssot/machine-learning/prediction-job-definitions",
      },
    });

    await expect(
      runData360V2Action(
        {
          tool: "data360_activate",
          action: "personalization.experience_config.create",
          target_org: "AgentforceSTDM",
          dry_run: true,
          params: {
            idOrAppSourceIdOrName: "ExampleConnector",
            body: { name: "SfPiParity_Experience" },
          },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({
      ok: true,
      action: "personalization.experience_config.create",
      safety: "confirmed",
      request: {
        method: "POST",
        path: "/services/data/v67.0/personalization/external-apps/ExampleConnector/personalization-experience-configs",
      },
    });
  });

  it("dry-runs representative destructive REST actions", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "stream.delete",
        target_org: "AgentforceSTDM",
        dry_run: true,
        params: { dataStreamId: "1ds000000000001AAA" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "stream.delete",
      dryRun: true,
      safety: "destructive",
      request: {
        method: "DELETE",
        path: "/services/data/v67.0/ssot/data-streams/1ds000000000001AAA",
      },
    });
  });

  it("executes representative local helper actions", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-d360-local-"));
    const csvPath = path.join(dir, "demo.csv");
    await writeFile(csvPath, "id,active\nA,true\n", "utf8");

    await expect(
      runData360V2Action(
        {
          tool: "data360_prepare",
          action: "csv_schema.infer",
          params: { csvPath, schemaName: "Demo", primaryKey: "id" },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: true, schema: { name: "Demo" } });
  });

  it("executes representative runbook-backed actions", async () => {
    requestMock.mockResolvedValue({
      metadata: [
        { name: "interaction_id" },
        { name: "topic" },
        { name: "trace_id" },
        { name: "turn_started" },
        { name: "who" },
        { name: "text" },
        { name: "sent_at" },
      ],
      data: [["interaction-1", "demo", "trace-1", "start", "Input", "hello", "start"]],
    });

    const result = await runData360V2Action(
      {
        tool: "data360_observe",
        action: "stdm.session_timeline",
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
      action: "stdm.session_timeline",
      capability: "agent_observability.stdm_session_timeline",
      capabilityKind: "runbook",
    });
  });

  it("executes representative journey actions", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "cleanup.plan",
        target_org: "AgentforceSTDM",
        params: { dataStreamIds: ["1ds000000000001AAA"] },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "cleanup.plan",
      resources: [{ type: "data_stream", id: "1ds000000000001AAA" }],
    });
  });
});
