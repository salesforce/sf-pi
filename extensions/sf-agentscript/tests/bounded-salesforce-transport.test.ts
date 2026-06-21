/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, test, vi } from "vitest";
import { boundedSoqlQuery } from "../lib/bounded-salesforce-transport.ts";

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

describe("boundedSoqlQuery cancellation", () => {
  test("pre-aborted signal returns an aborted result without fetching", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await boundedSoqlQuery(fakeConn() as never, "SELECT Id FROM Account", {
      signal: controller.signal,
      fetchImpl,
    });

    expect(result).toMatchObject({ ok: false, reason: "aborted" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
