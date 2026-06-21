/* SPDX-License-Identifier: Apache-2.0 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { listVersions } from "../lib/lifecycle.ts";

const fetchCalls: string[] = [];
let responses: unknown[] = [];

function fakeConn() {
  return {
    accessToken: "JWT",
    instanceUrl: "https://example.my.salesforce.com",
    getApiVersion: () => "67.0",
    getConnectionOptions: () => ({
      accessToken: "JWT",
      instanceUrl: "https://example.my.salesforce.com",
    }),
  };
}

beforeEach(() => {
  fetchCalls.length = 0;
  responses = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      fetchCalls.push(String(url));
      const body = responses.shift() ?? { records: [], totalSize: 0 };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

describe("listVersions", () => {
  test("uses bounded REST queries to list BotVersions", async () => {
    responses = [
      { totalSize: 1, records: [{ Id: "0XxBOT" }] },
      {
        totalSize: 2,
        records: [
          {
            Id: "0X9V3",
            VersionNumber: 3,
            DeveloperName: "v3",
            Status: "Inactive",
            CreatedDate: "2026-06-20T00:00:00.000+0000",
            LastModifiedDate: "2026-06-20T00:01:00.000+0000",
          },
          {
            Id: "0X9V2",
            VersionNumber: 2,
            DeveloperName: "v2",
            Status: "Active",
            CreatedDate: "2026-06-19T00:00:00.000+0000",
            LastModifiedDate: "2026-06-19T00:01:00.000+0000",
          },
        ],
      },
    ];

    const result = await listVersions(fakeConn() as never, "biBerk_FNOL_Voice_Agent");

    expect(result).toEqual({
      ok: true,
      agent_api_name: "biBerk_FNOL_Voice_Agent",
      bot_id: "0XxBOT",
      versions: [
        {
          bot_version_id: "0X9V3",
          version_number: 3,
          developer_name: "v3",
          status: "Inactive",
          created_date: "2026-06-20T00:00:00.000+0000",
          last_modified_date: "2026-06-20T00:01:00.000+0000",
        },
        {
          bot_version_id: "0X9V2",
          version_number: 2,
          developer_name: "v2",
          status: "Active",
          created_date: "2026-06-19T00:00:00.000+0000",
          last_modified_date: "2026-06-19T00:01:00.000+0000",
        },
      ],
    });
    expect(fetchCalls).toHaveLength(2);
    expect(decodeURIComponent(fetchCalls[0])).toContain(
      "FROM BotDefinition WHERE DeveloperName='biBerk_FNOL_Voice_Agent'",
    );
    expect(decodeURIComponent(fetchCalls[1])).toContain(
      "FROM BotVersion WHERE BotDefinitionId='0XxBOT' ORDER BY VersionNumber DESC",
    );
  });

  test("not found remains a clear agent-not-found error", async () => {
    responses = [{ totalSize: 0, records: [] }];
    await expect(listVersions(fakeConn() as never, "Missing_Bot")).rejects.toThrow(
      /Agent 'Missing_Bot' not found/,
    );
  });

  test("bounded lookup failures fail fast with lookup context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 })),
    );
    await expect(listVersions(fakeConn() as never, "Example_Bot")).rejects.toThrow(
      /BotDefinition lookup failed.*HTTP 500/,
    );
  });
});
