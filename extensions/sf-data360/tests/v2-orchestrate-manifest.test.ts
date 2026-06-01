/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("Data 360 v2 CSV manifest orchestration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("infers an Ingestion API schema from a CSV", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-d360-csv-"));
    const csvPath = path.join(dir, "providers.csv");
    await writeFile(
      csvPath,
      "provider_id,active,caseload_weight,CreatedDate\nPRV001,true,0.5,2026-06-01T00:00:00.000Z\n",
      "utf8",
    );

    const result = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "csv_schema.infer",
        target_org: "AgentforceSTDM",
        params: { csvPath, schemaName: "GPSProviders", primaryKey: "provider_id" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      schema: {
        name: "GPSProviders",
        label: "GPSProviders",
        schemaType: "IngestApi",
        fields: expect.arrayContaining([
          { name: "provider_id", label: "provider_id", dataType: "Text" },
          { name: "active", label: "active", dataType: "Boolean" },
          { name: "caseload_weight", label: "caseload_weight", dataType: "Number" },
          { name: "CreatedDate", label: "CreatedDate", dataType: "DateTime" },
        ]),
      },
      primaryKey: "provider_id",
      recordModifiedField: "CreatedDate",
    });
  });

  it("validates and plans a multi-file CSV ingestion manifest without mutation", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-d360-manifest-"));
    const csvPath = path.join(dir, "providers.csv");
    const manifestPath = path.join(dir, "ingest.json");
    await writeFile(csvPath, "provider_id,active\nPRV001,true\n", "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        source: { name: "TEst", connectionId: "1WM000000000000AAA" },
        datasets: [
          {
            csvPath,
            schemaName: "GPSProviders",
            streamName: "GPSProvidersStream",
            primaryKey: "provider_id",
          },
        ],
      }),
      "utf8",
    );

    await expect(
      runData360V2Action(
        {
          tool: "data360_orchestrate",
          action: "manifest.validate",
          target_org: "AgentforceSTDM",
          params: { manifestPath },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: true, datasetCount: 1 });

    const plan = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "manifest.plan",
        target_org: "AgentforceSTDM",
        params: { manifestPath },
      },
      env,
      ctx,
      undefined,
    );

    expect(plan).toMatchObject({ ok: true, tool: "data360_orchestrate", action: "manifest.plan" });
    expect(plan.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_connect", action: "source_schema.test" }),
        expect.objectContaining({ tool: "data360_prepare", action: "stream.create_ingest_api" }),
        expect.objectContaining({ tool: "data360_prepare", action: "ingest_job.create" }),
        expect.objectContaining({ tool: "data360_query", action: "sql.verify_rows" }),
      ]),
    );
  });

  it("runs a manifest end-to-end through schema, stream, job, poll, and verification", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-d360-manifest-run-"));
    const csvPath = path.join(dir, "providers.csv");
    const manifestPath = path.join(dir, "ingest.json");
    await writeFile(csvPath, "provider_id,active\nPRV001,true\n", "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        source: { name: "TEst", connectionId: "1WM000000000000AAA" },
        datasets: [
          {
            csvPath,
            schemaName: "GPSProviders",
            streamName: "GPSProvidersStream",
            primaryKey: "provider_id",
          },
        ],
      }),
      "utf8",
    );
    let queryCount = 0;
    requestMock.mockImplementation(async (request: { method: string; url: string }) => {
      if (request.url.includes("/schema") && request.method === "GET") return { schemas: [] };
      if (request.url.includes("/schema/actions/test")) return { ok: true };
      if (request.url.includes("/schema") && request.method === "PUT") return { ok: true };
      if (request.url.endsWith("/ssot/data-streams") && request.method === "POST") {
        return { name: "GPSProvidersStream_ABC" };
      }
      if (request.url.includes("/ssot/data-streams") && request.method === "GET") {
        return {
          dataStreams: [
            {
              name: "GPSProvidersStream_ABC",
              dataLakeObjectInfo: { name: "GPSProvidersStream_short_ABC__dll" },
            },
          ],
        };
      }
      if (request.url.includes("/ssot/query-sql")) return { data: [[queryCount++ > 0 ? 1 : 0]] };
      return {};
    });
    let createAttempts = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/services/oauth2/token")) {
        return jsonResponse({
          access_token: "secret-salesforce-token",
          instance_url: "https://example.my.salesforce.com",
        });
      }
      if (url.endsWith("/services/a360/token")) {
        return jsonResponse({
          access_token: "secret-data-cloud-token",
          instance_url: "tenant.example.c360a.salesforce.com",
        });
      }
      if (url.endsWith("/api/v1/ingest/jobs")) {
        createAttempts += 1;
        if (createAttempts === 1) {
          return jsonResponse(
            { error: "404 NOT_FOUND", message: "The requested resource doesn't exist." },
            404,
          );
        }
        return jsonResponse({ id: "job-1", state: "Open" }, 201);
      }
      if (url.endsWith("/batches")) return jsonResponse({ accepted: true });
      if (url.endsWith("/api/v1/ingest/jobs/job-1"))
        return jsonResponse({ id: "job-1", state: "JobComplete" });
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const exchange = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.exchange",
        target_org: "AgentforceSTDM",
        params: {
          strategy: "pkce",
          loginUrl: "https://test.salesforce.com",
          clientId: "public-client-id",
          redirectUri: "http://localhost:1717/OauthRedirect",
          authorizationCode: "secret-auth-code",
          codeVerifier: "secret-code-verifier",
        },
      },
      env,
      ctx,
      undefined,
    );
    const authSessionId = (exchange.authSession as { id: string }).id;

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "manifest.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: {
          manifestPath,
          authSessionId,
          pollIntervalMs: 0,
          maxPolls: 1,
          jobCreateRetryMs: 0,
          jobCreateMaxAttempts: 2,
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(createAttempts).toBe(2);
    expect(result).toMatchObject({
      ok: true,
      action: "manifest.run",
      results: [
        expect.objectContaining({
          schemaName: "GPSProviders",
          jobId: "job-1",
          jobState: "JobComplete",
          beforeRows: 0,
          dloName: "GPSProvidersStream_short_ABC__dll",
          afterRows: 1,
        }),
      ],
    });
  });

  it("makes ingest_csv.run a manifest-backed dry-run plan", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-d360-ingest-run-"));
    const csvPath = path.join(dir, "providers.csv");
    await writeFile(csvPath, "provider_id,active\nPRV001,true\n", "utf8");

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "ingest_csv.run",
        target_org: "AgentforceSTDM",
        dry_run: true,
        params: {
          sourceName: "TEst",
          connectionId: "1WM000000000000AAA",
          csvPath,
          schemaName: "GPSProviders",
          streamName: "GPSProvidersStream",
          primaryKey: "provider_id",
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      dryRun: true,
      action: "ingest_csv.run",
      summary: expect.stringContaining("dry-run"),
    });
    expect(orgCreateMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
