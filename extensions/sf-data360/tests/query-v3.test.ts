/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = {
  accessToken: "core-token",
  instanceUrl: "https://example.my.salesforce.com",
};
const connectSalesforceMock = vi.fn();
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  connectSalesforce: (input: unknown) => connectSalesforceMock(input),
}));

import { runDirectData360Request, runQueryV3 } from "../lib/query-v3.ts";

describe("Data 360 Query API V3 transport", () => {
  beforeEach(() => {
    connectSalesforceMock.mockReset();
    connectSalesforceMock.mockResolvedValue({
      connection,
      target: { targetOrg: "ExampleSandbox" },
    });
  });

  it("plans an exact direct API request without accepting an arbitrary host", async () => {
    const fetchFn = vi.fn();
    const result = await runDirectData360Request(
      {
        action: "api.request",
        dry_run: true,
        params: { api_family: "query", method: "GET", path: "/api/v3/query/query-1" },
      },
      "/workspace",
      undefined,
      fetchFn as never,
    );
    expect(result).toMatchObject({
      ok: true,
      apiFamily: "query",
      request: { method: "GET", path: "/api/v3/query/query-1" },
    });
    await expect(
      runDirectData360Request(
        {
          action: "api.request",
          dry_run: true,
          params: { api_family: "query", method: "GET", path: "https://example.test/api/v3/query" },
        },
        "/workspace",
      ),
    ).rejects.toThrow(/relative \/api/i);
  });

  it("plans the recommended V3 endpoint without token exchange", async () => {
    const fetchFn = vi.fn();
    const result = await runQueryV3(
      {
        action: "query.sql.run",
        target_org: "ExampleSandbox",
        dry_run: true,
        params: { sql: "SELECT 1", queryRowLimit: 1 },
      },
      "/workspace",
      undefined,
      fetchFn as never,
    );
    expect(result).toMatchObject({
      ok: true,
      apiVersion: "3",
      request: {
        method: "POST",
        path: "/api/v3/query",
        body: { sql: "SELECT 1", transferMode: "ADAPTIVE", queryRowLimit: 1 },
      },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("plans preferred chunk retrieval for completed V3 queries", async () => {
    const fetchFn = vi.fn();
    const result = await runQueryV3(
      {
        action: "query.sql.chunk",
        target_org: "ExampleSandbox",
        dry_run: true,
        params: { queryId: "query/1", chunkId: "chunk 2" },
      },
      "/workspace",
      undefined,
      fetchFn as never,
    );
    expect(result).toMatchObject({
      ok: true,
      request: {
        method: "GET",
        path: "/api/v3/query/query%2F1/chunks/chunk%202",
      },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("blocks query cancellation until mutation intent is explicit", async () => {
    const result = await runQueryV3(
      { action: "query.sql.cancel", params: { queryId: "query-1" } },
      "/workspace",
    );
    expect(result).toMatchObject({ ok: false, error: "CONFIRMATION_REQUIRED" });
  });

  it("exchanges the core token and invokes the trusted tenant endpoint", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: "tenant-token",
            instance_url: "https://example.c360a.salesforce.com",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [[1]], returnedRows: 1 }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "x-hyperdb-status": JSON.stringify({ queryId: "query-1" }),
          },
        }),
      );
    const result = await runQueryV3(
      { action: "query.sql.run", params: { sql: "SELECT 1" } },
      "/workspace",
      undefined,
      fetchFn as never,
    );
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      response: { data: [[1]], returnedRows: 1 },
      queryStatus: { queryId: "query-1" },
    });
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ href: "https://example.c360a.salesforce.com/api/v3/query" }),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
