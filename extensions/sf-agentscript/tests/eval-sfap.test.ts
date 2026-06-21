/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the SFAP host-fallback HTTP client built on bounded native fetch.
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
import { clearSfapEndpointCache, isSfapRoutingFailure, sfapRequest } from "../lib/eval/sfap.ts";

interface RequestArg {
  url: string;
}

function fakeConn(handler: (i: number, req: RequestArg) => unknown | Promise<unknown>): {
  conn: {
    accessToken: string;
    instanceUrl: string;
    getConnectionOptions: () => { accessToken: string };
  };
  calls: RequestArg[];
} {
  const calls: RequestArg[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request) => {
      const req = { url: String(url) };
      const idx = calls.length;
      calls.push(req);
      const result = await handler(idx, req);
      if (result && typeof result === "object" && "throws" in (result as object)) {
        const thrown = (
          result as {
            throws: { statusCode?: number; message?: string; errorCode?: string; name?: string };
          }
        ).throws;
        if (typeof thrown.statusCode === "number") {
          return new Response(JSON.stringify(thrown), { status: thrown.statusCode });
        }
        throw new Error(thrown.message || thrown.errorCode || thrown.name || "request failed");
      }
      return new Response(JSON.stringify(result), { status: 200 });
    }),
  );
  return {
    calls,
    conn: {
      accessToken: "JWT",
      instanceUrl: "https://fake.my.salesforce.com",
      getConnectionOptions: () => ({ accessToken: "JWT" }),
    },
  };
}

beforeEach(() => {
  clearSfapEndpointCache();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sfapRequest", () => {
  test("pre-aborted signal returns 499 without fetching", async () => {
    const controller = new AbortController();
    controller.abort();
    const { conn, calls } = fakeConn(() => ({ ok: true }));
    const result = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/einstein/foo",
      method: "GET",
      signal: controller.signal,
    });
    expect(result.status).toBe(499);
    expect(calls).toHaveLength(0);
  });

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

  test("infers 404 from ERROR_HTTP_404 in error body (jsforce surface)", async () => {
    // Reproduces the live bug: dev-edition SFAP returns an HTML 404 that
    // jsforce wraps with errorCode='ERROR_HTTP_404' and message=''. Without
    // the dedicated regex, our naive `\b\d{3}\b` couldn't see `_404` because
    // `_` is a word boundary char, so it fell back to 500.
    const { conn } = fakeConn(() => ({
      throws: { errorCode: "ERROR_HTTP_404", name: "ERROR_HTTP_404", message: "" },
    }));
    const result = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "POST",
      fallback: false,
      maxRetries: 0,
    });
    expect(result.status).toBe(404);
  });

  test("isSfapRoutingFailure detects the canonical org-not-enabled response", async () => {
    expect(
      isSfapRoutingFailure({
        status: 404,
        endpoint: "",
        body: { errorCode: "ERROR_HTTP_404", name: "ERROR_HTTP_404", message: "" },
      }),
    ).toBe(true);
    expect(
      isSfapRoutingFailure({
        status: 404,
        endpoint: "",
        body: "<html><body>URL No Longer Exists</body></html>",
      }),
    ).toBe(true);
    // Genuine 404 (e.g. wrong agent id) without the SFAP signature shouldn't trip this.
    expect(
      isSfapRoutingFailure({
        status: 404,
        endpoint: "",
        body: { errorCode: "NOT_FOUND", message: "Agent does not exist" },
      }),
    ).toBe(false);
    // Non-404 statuses obviously not.
    expect(isSfapRoutingFailure({ status: 500, endpoint: "", body: {} })).toBe(false);
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
    expect(result.endpoint_cache).toBe("bypass");
    expect(calls).toHaveLength(1);
  });

  test("uses the cached successful endpoint first on later calls", async () => {
    const { conn, calls } = fakeConn((i) => {
      if (i === 0) return { throws: { statusCode: 404, message: "Not Found" } };
      return { ok: true };
    });
    const first = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
    });
    const second = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
    });

    expect(first.endpoint).toBe("test.");
    expect(first.endpoint_cache).toBe("miss");
    expect(second.endpoint).toBe("test.");
    expect(second.endpoint_cache).toBe("hit");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.salesforce.com/x",
      "https://test.api.salesforce.com/x",
      "https://test.api.salesforce.com/x",
    ]);
  });

  test("refreshes the cached endpoint after a cached 404", async () => {
    const { conn, calls } = fakeConn((i) => {
      if (i === 0) return { throws: { statusCode: 404, message: "Not Found" } };
      if (i === 1) return { ok: true }; // seed test.api
      if (i === 2) return { throws: { statusCode: 404, message: "Not Found" } }; // cached test.api stale
      if (i === 3) return { throws: { statusCode: 404, message: "Not Found" } }; // api also wrong
      return { ok: true }; // dev.api succeeds
    });
    await sfapRequest(conn as never, { url: "https://api.salesforce.com/x", method: "GET" });
    const refreshed = await sfapRequest(conn as never, {
      url: "https://api.salesforce.com/x",
      method: "GET",
    });

    expect(refreshed.endpoint).toBe("dev.");
    expect(refreshed.endpoint_cache).toBe("refresh");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.salesforce.com/x",
      "https://test.api.salesforce.com/x",
      "https://test.api.salesforce.com/x",
      "https://api.salesforce.com/x",
      "https://dev.api.salesforce.com/x",
    ]);
  });
});
