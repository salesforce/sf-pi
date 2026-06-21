/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, test, vi } from "vitest";
import { boundedPromise, boundedSoqlQuery } from "../lib/bounded-salesforce-transport.ts";

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

describe("boundedPromise", () => {
  test("rejects when an operation never settles", async () => {
    vi.useFakeTimers();
    try {
      const result = boundedPromise(new Promise<unknown>(() => undefined), "metadata read", 5);
      const assertion = expect(result).rejects.toMatchObject({
        name: "BoundedOperationTimeoutError",
        timedOutAfterMs: 5,
      });
      await vi.advanceTimersByTimeAsync(5);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

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
