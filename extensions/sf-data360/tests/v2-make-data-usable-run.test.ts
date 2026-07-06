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

describe("Data 360 v2 make_data_usable.run", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("requires confirmation before running the mutating journey", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_orchestrate",
        action: "make_data_usable.run",
        target_org: "AgentforceSTDM",
        params: { manifestPath: "/tmp/example.json", authSessionId: "session" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  });

  it("runs manifest ingestion and returns a harmonization plan", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pi-d360-make-usable-"));
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
            targetDmo: "Provider__dlm",
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
      if (request.url.includes("/ssot/query-sql")) return { data: [[queryCount++ > 0 ? 2 : 0]] };
      return {};
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
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
        if (url.endsWith("/api/v1/ingest/jobs"))
          return jsonResponse({ id: "job-1", state: "Open" }, 201);
        if (url.endsWith("/batches")) return jsonResponse({ accepted: true });
        if (url.endsWith("/api/v1/ingest/jobs/job-1"))
          return jsonResponse({ id: "job-1", state: "JobComplete" });
        throw new Error(`Unexpected URL ${url}`);
      }),
    );
    const exchange = await runData360V2Action(
      {
        tool: "data360_connect",
        action: "auth.exchange",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
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
        action: "make_data_usable.run",
        target_org: "AgentforceSTDM",
        allow_confirmed: true,
        params: { manifestPath, authSessionId, pollIntervalMs: 0, maxPolls: 1 },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "make_data_usable.run",
      journey: "make_data_usable",
      ingestion: { ok: true },
      harmonizationPlan: expect.arrayContaining([
        expect.objectContaining({ tool: "data360_harmonize", action: "dmo.get" }),
        expect.objectContaining({ tool: "data360_harmonize", action: "mapping.create" }),
        expect.objectContaining({ tool: "data360_query", action: "sql.verify_rows" }),
      ]),
    });
    expect(result.report).toContain("Make data usable run complete");
    expect(result.report).toContain("GPSProvidersStream_short_ABC__dll");
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
