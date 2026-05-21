/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { createData360SqlStrategy } from "../lib/modes/data360-sql.ts";
import { createSoqlStrategy } from "../lib/modes/soql.ts";
import { createSoslStrategy } from "../lib/modes/sosl.ts";
import type { Method, SfDataExplorerTransport } from "../lib/transport.ts";

function fakeTransport(): SfDataExplorerTransport & {
  calls: Array<{ method: Method; path: string; query?: Record<string, unknown>; body?: unknown }>;
} {
  const calls: Array<{
    method: Method;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
  }> = [];
  const t: SfDataExplorerTransport & { calls: typeof calls } = {
    calls,
    info: { mode: "sf-pi-internals", sfPiPath: "/tmp/sf-pi" },
    resolveTarget: async () => ({ targetOrg: "my-org", apiVersion: "66.0", orgType: "production" }),
    callRest: async (args) => {
      calls.push({ method: args.method, path: args.path, query: args.query, body: args.body });
      if (args.path === "/sobjects")
        return {
          status: 200,
          path: "/services/data/v66.0/sobjects",
          context: { targetOrg: "my-org", apiVersion: "66.0", orgType: "production" },
          body: {
            sobjects: [
              {
                name: "Account",
                label: "Account",
                custom: false,
                queryable: true,
                searchable: true,
              },
            ],
          } as any,
        };
      if (args.path.includes("/describe"))
        return {
          status: 200,
          path: args.path,
          context: { targetOrg: "my-org", apiVersion: "66.0", orgType: "production" },
          body: {
            fields: [
              { name: "Id", label: "Id", type: "id" },
              { name: "Name", label: "Name", type: "string" },
            ],
          } as any,
        };
      return {
        status: 200,
        path: args.path,
        context: { targetOrg: "my-org", apiVersion: "66.0", orgType: "production" },
        body: {} as any,
      };
    },
    querySoql: async (args) => {
      calls.push({
        method: "GET",
        path: args.queryAll ? "/queryAll" : "/query",
        query: { q: args.soql },
      });
      return {
        status: 200,
        path: "/query",
        context: { targetOrg: "my-org", apiVersion: "66.0", orgType: "production" },
        body: { totalSize: 0, done: true, records: [] },
      };
    },
    searchSosl: async (args) => {
      calls.push({ method: "GET", path: "/search", query: { q: args.sosl } });
      return {
        status: 200,
        path: "/search",
        context: { targetOrg: "my-org", apiVersion: "66.0", orgType: "production" },
        body: [],
      };
    },
    queryData360Sql: async (args) => {
      calls.push({ method: "POST", path: "/ssot/query-sql", body: { sql: args.sql } });
      return {
        status: 200,
        path: "/ssot/query-sql",
        context: { targetOrg: "my-org", apiVersion: "66.0", orgType: "production" },
        body: { metadata: [{ name: "id" }], data: [], returnedRows: 0 },
      };
    },
    clearCache: () => {},
  };
  return t;
}

describe("strategies call expected transport endpoints", () => {
  it("SOQL uses /sobjects, describe, and /query", async () => {
    const transport = fakeTransport();
    const strategy = createSoqlStrategy({
      transport,
      org: "my-org",
      initial: { objects: [], cacheLine: "" },
    });
    const catalog = await strategy.loadCatalog(true);
    await strategy.loadFields(catalog.value[0]!, true);
    await strategy.runQuery("SELECT Id FROM Account LIMIT 1");
    expect(transport.calls.map((c) => c.path)).toEqual([
      "/sobjects",
      "/sobjects/Account/describe",
      "/query",
    ]);
  });

  it("SOSL uses /search", async () => {
    const transport = fakeTransport();
    const strategy = createSoslStrategy({
      transport,
      org: "my-org",
      initial: { objects: [], cacheLine: "" },
    });
    await strategy.runQuery("FIND {acme} RETURNING Account(Id) LIMIT 1");
    expect(transport.calls.at(-1)).toMatchObject({ method: "GET", path: "/search" });
  });

  it("Data 360 SQL uses compact metadata and /ssot/query-sql", async () => {
    const transport = fakeTransport();
    // Override Data 360 metadata responses for this test.
    transport.callRest = async (args: any) => {
      transport.calls.push({
        method: args.method,
        path: args.path,
        query: args.query,
        body: args.body,
      });
      const body =
        args.path === "/ssot/metadata"
          ? {
              metadata: [
                {
                  name: "ssot__Individual__dlm",
                  fields: [{ name: "id", displayName: "Id", type: "Text" }],
                },
              ],
            }
          : { metadata: [{ name: "ssot__Individual__dlm", displayName: "Individual" }] };
      return {
        status: 200,
        path: args.path,
        context: { targetOrg: "my-org", apiVersion: "66.0", orgType: "production" },
        body,
      } as any;
    };
    const strategy = createData360SqlStrategy({
      transport,
      org: "my-org",
      initial: { objects: [], cacheLine: "" },
      requestRender: () => {},
    });
    const catalog = await strategy.loadCatalog(true);
    await strategy.loadFields(catalog.value[0]!, true);
    await strategy.runQuery("SELECT id FROM ssot__Individual__dlm LIMIT 1");
    expect(transport.calls.map((c) => c.path)).toEqual([
      "/ssot/metadata-entities",
      "/ssot/metadata-entities",
      "/ssot/metadata",
      "/ssot/query-sql",
    ]);
    expect(transport.calls[2]).toMatchObject({
      method: "GET",
      path: "/ssot/metadata",
      query: { entityName: "ssot__Individual__dlm" },
    });
  });
});
