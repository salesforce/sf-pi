/* SPDX-License-Identifier: Apache-2.0 */

import { beforeEach, describe, expect, test, vi } from "vitest";
import { activateVersion, deactivateVersion } from "../lib/lifecycle.ts";

const fetchCalls: Array<{ url: string; method?: string; body?: string }> = [];
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
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), method: init?.method, body: init?.body as string });
      const body = responses.shift() ?? { records: [], totalSize: 0 };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
});

describe("activate/deactivate lifecycle bounded transport", () => {
  test("activateVersion resolves latest version and calls Connect activation endpoint", async () => {
    responses = [
      { records: [{ Id: "0XxBOT" }], totalSize: 1 },
      { records: [{ Id: "0X9V3", VersionNumber: 3, Status: "Inactive" }], totalSize: 1 },
      { success: true, isActivated: true },
    ];

    const row = await activateVersion({ conn: fakeConn() as never, agentApiName: "My_Agent" });

    expect(row).toMatchObject({ Id: "0X9V3", VersionNumber: 3, Status: "Active" });
    expect(fetchCalls).toHaveLength(3);
    expect(decodeURIComponent(fetchCalls[0].url)).toContain("FROM BotDefinition");
    expect(decodeURIComponent(fetchCalls[1].url)).toContain("FROM BotVersion");
    expect(fetchCalls[2]).toMatchObject({
      method: "POST",
      url: "https://example.my.salesforce.com/services/data/v67.0/connect/bot-versions/0X9V3/activation",
    });
    expect(JSON.parse(fetchCalls[2].body ?? "{}")).toEqual({ status: "Active" });
  });

  test("deactivateVersion is idempotent when latest version is already inactive", async () => {
    responses = [
      { records: [{ Id: "0XxBOT" }], totalSize: 1 },
      { records: [{ Id: "0X9V3", VersionNumber: 3, Status: "Inactive" }], totalSize: 1 },
    ];

    const row = await deactivateVersion({ conn: fakeConn() as never, agentApiName: "My_Agent" });

    expect(row).toMatchObject({ Id: "0X9V3", VersionNumber: 3, Status: "Inactive" });
    expect(fetchCalls).toHaveLength(2);
  });

  test("activation failure surfaces server messages", async () => {
    responses = [
      { records: [{ Id: "0XxBOT" }], totalSize: 1 },
      { records: [{ Id: "0X9V3", VersionNumber: 3, Status: "Inactive" }], totalSize: 1 },
      { success: false, messages: ["no user assigned"] },
    ];

    await expect(
      activateVersion({ conn: fakeConn() as never, agentApiName: "My_Agent" }),
    ).rejects.toThrow(/no user assigned/);
  });
});
