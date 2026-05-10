/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the SFAP host-fallback HTTP client built on Connection.request.
 *
 * The contract these tests pin:
 *   - 200 succeeds and reports the prefix used.
 *   - 404 walks api → test.api → dev.api in order, stopping on first 200.
 *   - 5xx retries up to maxRetries on the SAME endpoint, then terminates.
 *   - 4xx (other than 404 with more endpoints) terminates immediately.
 *   - Connection-level errors (ENOTFOUND, etc.) are treated as retryable 503.
 *   - Never throws on HTTP errors — caller decides.
 *
 * We use a fake Connection. No real network. Backoff is awaited via vitest
 * fake timers to keep the suite fast.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { sfapRequest } from "../lib/eval/sfap.ts";

interface RequestArg {
  url: string;
}

function fakeConn(handler: (i: number, req: RequestArg) => unknown | Promise<unknown>): {
  conn: { request: <T>(req: RequestArg) => Promise<T>; instanceUrl: string };
  calls: RequestArg[];
} {
  const calls: RequestArg[] = [];
  return {
    calls,
    conn: {
      instanceUrl: "https://fake.my.salesforce.com",
      request: (async <T>(req: RequestArg): Promise<T> => {
        const idx = calls.length;
        calls.push(req);
        const result = await handler(idx, req);
        if (result && typeof result === "object" && "throws" in (result as object)) {
          throw (result as { throws: unknown }).throws;
        }
        return result as T;
      }) as <T>(req: RequestArg) => Promise<T>,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sfapRequest", () => {
  test("200 on the first endpoint succeeds with prefix=''", async () => {
    const { conn, calls } = fakeConn(() => ({ result: "yo" }));
    const result = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/einstein/foo",
      method: "GET",
    });
    expect(result.status).toBe(200);
    expect(result.endpoint).toBe("");
    expect(result.body).toEqual({ result: "yo" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.salesforce.com/einstein/foo");
  });

  test("404 walks api → test.api → dev.api and stops on first 200", async () => {
    const { conn, calls } = fakeConn((i) => {
      if (i < 2) {
        return { throws: { statusCode: 404, message: "Not Found" } };
      }
      return { ok: true };
    });
    const result = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/einstein/foo",
      method: "GET",
    });
    expect(result.status).toBe(200);
    expect(result.endpoint).toBe("dev.");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.salesforce.com/einstein/foo",
      "https://test.api.salesforce.com/einstein/foo",
      "https://dev.api.salesforce.com/einstein/foo",
    ]);
  });

  test("5xx retries on the same endpoint up to maxRetries, then terminates", async () => {
    const { conn, calls } = fakeConn(() => ({
      throws: { statusCode: 503, message: "Service Unavailable" },
    }));
    const promise = sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "POST",
      maxRetries: 2,
      fallback: false, // don't walk endpoints — isolate retry behavior
    });
    // Advance through both backoff sleeps.
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result.status).toBe(503);
    // 3 attempts total: initial + 2 retries.
    expect(calls).toHaveLength(3);
    // All three on the same prefix.
    expect(new Set(calls.map((c) => c.url)).size).toBe(1);
  });

  test("4xx terminates immediately (no retry, no walk)", async () => {
    const { conn, calls } = fakeConn(() => ({
      throws: { statusCode: 401, message: "Unauthorized" },
    }));
    const result = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
    });
    expect(result.status).toBe(401);
    expect(result.endpoint).toBe("");
    expect(calls).toHaveLength(1);
  });

  test("connection-level error is treated as retryable 503", async () => {
    let callCount = 0;
    const { conn, calls } = fakeConn(() => {
      callCount++;
      if (callCount <= 2) {
        return { throws: { message: "ENOTFOUND api.salesforce.com" } };
      }
      return { ok: true };
    });
    const promise = sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "POST",
      maxRetries: 2,
      fallback: false,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const result = await promise;
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(3);
  });

  test("404 walks even when fallback=true is the default", async () => {
    const { conn } = fakeConn((i) =>
      i === 0 ? { throws: { statusCode: 404, message: "Not Found" } } : { ok: true },
    );
    const result = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
    });
    expect(result.endpoint).toBe("test.");
    expect(result.status).toBe(200);
  });

  test("does not walk when fallback=false", async () => {
    const { conn, calls } = fakeConn(() => ({
      throws: { statusCode: 404, message: "Not Found" },
    }));
    const result = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
      fallback: false,
    });
    expect(result.status).toBe(404);
    expect(calls).toHaveLength(1);
  });
});
