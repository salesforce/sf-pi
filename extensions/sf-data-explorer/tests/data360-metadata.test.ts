/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { createData360SqlStrategy } from "../lib/modes/data360-sql.ts";
import type { Method, SfDataExplorerTransport } from "../lib/transport.ts";

function transportForMetadata(body: Record<string, unknown>): SfDataExplorerTransport & {
  calls: Array<{ method: Method; path: string; query?: Record<string, unknown>; body?: unknown }>;
} {
  const calls: Array<{
    method: Method;
    path: string;
    query?: Record<string, unknown>;
    body?: unknown;
  }> = [];
  return {
    calls,
    info: { mode: "sf-pi-internals", sfPiPath: "/tmp/sf-pi" },
    resolveTarget: async () => ({ targetOrg: "wh", apiVersion: "66.0", orgType: "production" }),
    callRest: async (args) => {
      calls.push({ method: args.method, path: args.path, query: args.query, body: args.body });
      return {
        status: 200,
        path: args.path,
        context: { targetOrg: "wh", apiVersion: "66.0", orgType: "production" },
        body,
      } as any;
    },
    querySoql: async () => {
      throw new Error("not used");
    },
    searchSosl: async () => {
      throw new Error("not used");
    },
    queryData360Sql: async () => {
      throw new Error("query-sql should not be used for metadata field loading");
    },
    clearCache: () => {},
  };
}

describe("Data 360 /ssot/metadata field extraction", () => {
  it("extracts fields from metadata[0].fields envelope", async () => {
    const transport = transportForMetadata({
      metadata: [
        {
          name: "donor_proposal_docs_dmo_chunk__dlm",
          fields: [
            {
              name: "ChunkType__c",
              displayName: "Chunk Type",
              type: "STRING",
              businessType: "TEXT",
            },
            { name: "RecordId__c", displayName: "Record Id", type: "STRING", businessType: "TEXT" },
          ],
        },
      ],
    });
    const strategy = createData360SqlStrategy({
      transport,
      org: "wh",
      initial: { objects: [], cacheLine: "" },
      requestRender: () => {},
    });
    const loaded = await strategy.loadFields(
      { name: "donor_proposal_docs_dmo_chunk__dlm", entityType: "DMO" },
      true,
    );
    expect(loaded.value.map((f) => f.name)).toEqual(["ChunkType__c", "RecordId__c"]);
    expect(loaded.value[0]).toMatchObject({
      label: "Chunk Type",
      type: "STRING",
      dataType: "STRING",
      businessType: "TEXT",
    });
    expect(transport.calls).toEqual([
      {
        method: "GET",
        path: "/ssot/metadata",
        query: { entityName: "donor_proposal_docs_dmo_chunk__dlm" },
        body: undefined,
      },
    ]);
  });

  it("surfaces metadata endpoint error bodies instead of showing an empty field list", async () => {
    const transport = transportForMetadata({
      errorCode: "ILLEGAL_QUERY_PARAMETER_VALUE",
      message: "Field Ids should not be empty",
    });
    const strategy = createData360SqlStrategy({
      transport,
      org: "wh",
      initial: { objects: [], cacheLine: "" },
      requestRender: () => {},
    });
    await expect(
      strategy.loadFields({ name: "missing__dlm", entityType: "DMO" }, true),
    ).rejects.toThrow("ILLEGAL_QUERY_PARAMETER_VALUE");
  });
});
