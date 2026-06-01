/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("Data 360 v2 tenant ingest job actions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dry-runs tenant ingest job creation without requiring a Data Cloud token", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "ingest_job.create",
        target_org: "AgentforceSTDM",
        dry_run: true,
        params: {
          sourceName: "DemoSource",
          object: "DemoObject",
        },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_prepare",
      action: "ingest_job.create",
      dryRun: true,
      targetOrg: "AgentforceSTDM",
      request: {
        method: "POST",
        tenantPath: "/api/v1/ingest/jobs",
        body: {
          operation: "upsert",
          sourceName: "DemoSource",
          object: "DemoObject",
        },
      },
      auth: { required: true, status: "not_configured" },
    });
  });

  it("dry-runs tenant CSV upload, close, and poll requests", async () => {
    await expect(
      runData360V2Action(
        {
          tool: "data360_prepare",
          action: "ingest_job.upload_csv",
          target_org: "AgentforceSTDM",
          dry_run: true,
          params: { jobId: "job-123", csvPath: "data/demo.csv" },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({
      ok: true,
      request: {
        method: "PUT",
        tenantPath: "/api/v1/ingest/jobs/job-123/batches",
        file: { path: "data/demo.csv", contentType: "text/csv" },
      },
    });

    await expect(
      runData360V2Action(
        {
          tool: "data360_prepare",
          action: "ingest_job.close",
          target_org: "AgentforceSTDM",
          dry_run: true,
          params: { jobId: "job-123" },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({
      ok: true,
      request: {
        method: "PATCH",
        tenantPath: "/api/v1/ingest/jobs/job-123",
        body: { state: "UploadComplete" },
      },
    });

    await expect(
      runData360V2Action(
        {
          tool: "data360_prepare",
          action: "ingest_job.poll",
          target_org: "AgentforceSTDM",
          dry_run: true,
          params: { jobId: "job-123" },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({
      ok: true,
      request: { method: "GET", tenantPath: "/api/v1/ingest/jobs/job-123" },
    });
  });

  it("executes tenant ingest job creation with an in-memory auth session without leaking tokens", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (url === "https://tenant.example.c360a.salesforce.com/api/v1/ingest/jobs") {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer secret-data-cloud-token",
        );
        expect(init?.method).toBe("POST");
        return jsonResponse({ id: "job-123", state: "Open" });
      }
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
        tool: "data360_prepare",
        action: "ingest_job.create",
        target_org: "AgentforceSTDM",
        params: { authSessionId, sourceName: "DemoSource", object: "DemoObject" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      tool: "data360_prepare",
      action: "ingest_job.create",
      status: 200,
      response: { id: "job-123", state: "Open" },
      auth: {
        required: true,
        status: "ready",
        tenantHost: "tenant.example.c360a.salesforce.com",
      },
    });
    const text = JSON.stringify(result).toLowerCase();
    expect(text).not.toContain("secret-salesforce-token");
    expect(text).not.toContain("secret-data-cloud-token");
    expect(text).not.toContain("secret-auth-code");
    expect(text).not.toContain("secret-code-verifier");
  });

  it("executes tenant CSV upload, close, and poll with an in-memory auth session", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pi-d360-ingest-test-"));
    const csvPath = path.join(tempDir, "demo.csv");
    await writeFile(csvPath, "Id,Name\n1,Demo\n", "utf8");
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
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
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (
        url === "https://tenant.example.c360a.salesforce.com/api/v1/ingest/jobs/job-123/batches"
      ) {
        expect(init?.method).toBe("PUT");
        expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("text/csv");
        expect(init?.body).toBe("Id,Name\n1,Demo\n");
        return jsonResponse({ accepted: true });
      }
      if (url === "https://tenant.example.c360a.salesforce.com/api/v1/ingest/jobs/job-123") {
        if (init?.method === "PATCH") {
          expect(init.body).toBe(JSON.stringify({ state: "UploadComplete" }));
          return jsonResponse({ id: "job-123", state: "UploadComplete" });
        }
        if (init?.method === "GET") {
          return jsonResponse({ id: "job-123", state: "JobComplete" });
        }
      }
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

    await expect(
      runData360V2Action(
        {
          tool: "data360_prepare",
          action: "ingest_job.upload_csv",
          target_org: "AgentforceSTDM",
          params: { authSessionId, jobId: "job-123", csvPath },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: true, status: 200, response: { accepted: true } });

    await expect(
      runData360V2Action(
        {
          tool: "data360_prepare",
          action: "ingest_job.close",
          target_org: "AgentforceSTDM",
          params: { authSessionId, jobId: "job-123" },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: true, response: { id: "job-123", state: "UploadComplete" } });

    await expect(
      runData360V2Action(
        {
          tool: "data360_prepare",
          action: "ingest_job.poll",
          target_org: "AgentforceSTDM",
          params: { authSessionId, jobId: "job-123" },
        },
        env,
        ctx,
        undefined,
      ),
    ).resolves.toMatchObject({ ok: true, response: { id: "job-123", state: "JobComplete" } });

    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns an auth recovery path instead of executing tenant ingest without auth", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "ingest_job.create",
        target_org: "AgentforceSTDM",
        params: { sourceName: "DemoSource", object: "DemoObject" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: false,
      error: "DATA_CLOUD_INGEST_AUTH_REQUIRED",
      auth: { required: true, status: "not_configured" },
      recover_via: {
        tool: "data360_connect",
        action: "actions.search",
        params: { query: "ingest auth" },
      },
    });
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}
