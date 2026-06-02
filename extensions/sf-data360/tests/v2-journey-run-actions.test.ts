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

describe("Data 360 v2 remaining run journeys", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("runs ingest_csv.run through manifest execution when confirmed", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-d360-ingest-csv-run-"));
    const csvPath = path.join(dir, "providers.csv");
    await writeFile(csvPath, "provider_id,active\nPRV001,true\n", "utf8");
    mockManifestRest();
    mockTenantIngest();
    const authSessionId = await createAuthSession();

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "ingest_csv.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: {
          authSessionId,
          csvPath,
          sourceName: "TEst",
          connectionId: "1WM000000000000AAA",
          schemaName: "GPSProviders",
          streamName: "GPSProvidersStream",
          primaryKey: "provider_id",
          pollIntervalMs: 0,
          maxPolls: 1,
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: true, action: "ingest_csv.run" });
    expect(result.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ jobState: "JobComplete", afterRows: 2 })]),
    );
  });

  it("runs semantic_retrieval.run with reviewed payloads", async () => {
    requestMock.mockResolvedValue({ id: "ok", name: "ok" });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "semantic_retrieval.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: {
          searchIndexBody: { name: "DemoIndex" },
          retrieverBody: { name: "DemoRetriever" },
          retrieverConfigBody: { name: "DemoRetrieverConfig" },
          retrieverIdOrName: "DemoRetriever",
          semanticModelName: "DemoSemanticModel",
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: true, action: "semantic_retrieval.run" });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "search_index.create", ok: true }),
        expect.objectContaining({ action: "retriever.create", ok: true }),
        expect.objectContaining({ action: "retriever.config.create", ok: true }),
        expect.objectContaining({ action: "semantic_model.validate", ok: true }),
      ]),
    );
  });

  it("runs build_segment.run with reviewed payloads", async () => {
    requestMock.mockResolvedValue({ id: "ok", apiName: "Demo__cio" });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "build_segment.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: {
          ciValidateBody: { sql: "SELECT 1" },
          ciBody: { apiName: "Demo__cio" },
          ciName: "Demo__cio",
          segmentBody: { name: "DemoSegment" },
          segmentId: "segment-1",
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: true, action: "build_segment.run" });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "ci.validate", ok: true }),
        expect.objectContaining({ action: "ci.create", ok: true }),
        expect.objectContaining({ action: "ci.run", ok: true }),
        expect.objectContaining({ action: "ci.run.status", ok: true }),
        expect.objectContaining({ action: "segment.create", ok: true }),
        expect.objectContaining({ action: "segment.publish", ok: true }),
      ]),
    );
  });

  it("runs activate_segment.run with reviewed payloads", async () => {
    requestMock.mockResolvedValue({ id: "ok" });

    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "activate_segment.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: {
          segmentId: "segment-1",
          activationTargetBody: { name: "DemoTarget" },
          activationBody: { name: "DemoActivation" },
          activationId: "activation-1",
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: true, action: "activate_segment.run" });
    expect(result.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "segment.get", ok: true }),
        expect.objectContaining({ action: "activation_target.create", ok: true }),
        expect.objectContaining({ action: "activation.create", ok: true }),
        expect.objectContaining({ action: "activation.get", ok: true }),
      ]),
    );
  });

  it("gates mutating run journeys behind allow_confirmed", async () => {
    await expect(
      runData360V2Action(
        { tool: "data360_orchestrate", action: "semantic_retrieval.run", params: {} },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  });
});

async function createAuthSession(): Promise<string> {
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
  return (exchange.authSession as { id: string }).id;
}

function mockManifestRest(): void {
  let queryCount = 0;
  requestMock.mockImplementation(async (request: { method: string; url: string }) => {
    if (request.url.includes("/schema") && request.method === "GET") return { schemas: [] };
    if (request.url.includes("/schema/actions/test")) return { ok: true };
    if (request.url.includes("/schema") && request.method === "PUT") return { ok: true };
    if (request.url.endsWith("/ssot/data-streams") && request.method === "POST")
      return { name: "GPSProvidersStream_ABC" };
    if (request.url.includes("/ssot/data-streams") && request.method === "GET")
      return {
        dataStreams: [
          {
            name: "GPSProvidersStream_ABC",
            dataLakeObjectInfo: { name: "GPSProvidersStream_short_ABC__dll" },
          },
        ],
      };
    if (request.url.includes("/ssot/query-sql")) return { data: [[queryCount++ > 0 ? 2 : 0]] };
    return { id: "ok" };
  });
}

function mockTenantIngest(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/services/oauth2/token"))
        return jsonResponse({
          access_token: "secret-salesforce-token",
          instance_url: "https://example.my.salesforce.com",
        });
      if (url.endsWith("/services/a360/token"))
        return jsonResponse({
          access_token: "secret-data-cloud-token",
          instance_url: "tenant.example.c360a.salesforce.com",
        });
      if (url.endsWith("/api/v1/ingest/jobs"))
        return jsonResponse({ id: "job-1", state: "Open" }, 201);
      if (url.endsWith("/batches")) return jsonResponse({ accepted: true });
      if (url.endsWith("/api/v1/ingest/jobs/job-1"))
        return jsonResponse({ id: "job-1", state: "JobComplete" });
      throw new Error(`Unexpected URL ${url}`);
    }),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
