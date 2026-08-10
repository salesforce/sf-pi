/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for `connRequest` body serialization.
 *
 * The contract under test:
 *   - object bodies   → `JSON.stringify` once (the common path)
 *   - string bodies   → passed through unchanged (caller already serialized)
 *   - undefined body  → omitted
 *
 * The string-passthrough rule is the bug fix: jsforce sends `request.body`
 * to the wire as-is, so re-stringifying a JSON string produced
 * `JSON_PARSER_ERROR: Value does not match expected type` on `/ssot/query-sql`.
 * That bit any caller (notably LLM tool inputs declared as `Type.Any()`)
 * that handed us an already-stringified body.
 */

import { describe, expect, test, vi } from "vitest";

import { connRequest, serializeBody } from "../sf-conn/request.ts";

function throwingConn(err: unknown) {
  return {
    request: vi.fn(async () => {
      throw err;
    }),
  } as unknown as Parameters<typeof connRequest>[0];
}

function fakeConn(spy: (req: { body?: unknown }) => unknown) {
  return {
    request: vi.fn(async (req: { body?: unknown }) => spy(req)),
  } as unknown as Parameters<typeof connRequest>[0];
}

describe("serializeBody", () => {
  test("returns undefined for undefined", () => {
    expect(serializeBody(undefined)).toBeUndefined();
  });

  test("passes string bodies through unchanged", () => {
    const body = '{"sql":"SELECT 1"}';
    expect(serializeBody(body)).toBe(body);
  });

  test("JSON-stringifies non-string values exactly once", () => {
    expect(serializeBody({ sql: "SELECT 1" })).toBe('{"sql":"SELECT 1"}');
    expect(serializeBody([1, 2, 3])).toBe("[1,2,3]");
    expect(serializeBody(null)).toBe("null");
    expect(serializeBody(0)).toBe("0");
  });
});

describe("connRequest body handling", () => {
  test("forwards object bodies as a JSON string (not re-stringified)", async () => {
    const captured: Array<unknown> = [];
    const conn = fakeConn((req) => {
      captured.push(req.body);
      return { ok: true };
    });

    await connRequest(conn, {
      method: "POST",
      url: "/services/data/v66.0/ssot/query-sql",
      body: { sql: "SELECT 1" },
    });

    expect(captured).toEqual(['{"sql":"SELECT 1"}']);
  });

  test("forwards string bodies unchanged", async () => {
    const captured: Array<unknown> = [];
    const conn = fakeConn((req) => {
      captured.push(req.body);
      return { ok: true };
    });

    const raw = '{"sql":"SELECT 1"}';
    await connRequest(conn, {
      method: "POST",
      url: "/services/data/v66.0/ssot/query-sql",
      body: raw,
    });

    expect(captured).toEqual([raw]);
  });

  test("omits the body when undefined", async () => {
    const captured: Array<unknown> = [];
    const conn = fakeConn((req) => {
      captured.push(req.body);
      return { ok: true };
    });

    await connRequest(conn, {
      method: "GET",
      url: "/services/data/v66.0/ssot/data-spaces",
    });

    expect(captured).toEqual([undefined]);
  });

  test("prefers bounded native fetch when the connection exposes token and instance URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ totalSize: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const conn = {
      accessToken: "JWT",
      instanceUrl: "https://example.my.salesforce.com",
      request: vi.fn(),
    } as unknown as Parameters<typeof connRequest>[0];

    const response = await connRequest(conn, {
      method: "GET",
      url: "/services/data/v67.0/ssot/data-spaces",
    });

    expect(response).toEqual({ status: 200, body: { totalSize: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.my.salesforce.com/services/data/v67.0/ssot/data-spaces",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer JWT" }),
      }),
    );
    expect(conn.request).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("refreshes auth and retries native fetch once after INVALID_SESSION_ID", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ errorCode: "INVALID_SESSION_ID" }]), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalSize: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const conn = {
      accessToken: "OLD",
      instanceUrl: "https://example.my.salesforce.com",
      refreshAuth: vi.fn().mockImplementation(function (this: { accessToken: string }) {
        this.accessToken = "NEW";
        return Promise.resolve();
      }),
      request: vi.fn(),
    } as unknown as Parameters<typeof connRequest>[0];

    const response = await connRequest(conn, {
      method: "GET",
      url: "/services/data/v67.0/ssot/data-spaces",
    });

    expect(response).toEqual({ status: 200, body: { totalSize: 1 } });
    expect(conn.refreshAuth).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.my.salesforce.com/services/data/v67.0/ssot/data-spaces",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer OLD" }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.my.salesforce.com/services/data/v67.0/ssot/data-spaces",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer NEW" }),
      }),
    );
    expect(conn.request).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  test("coalesces concurrent expired-session refreshes for one connection", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get("Authorization");
      return authorization === "Bearer OLD"
        ? new Response(JSON.stringify([{ errorCode: "INVALID_SESSION_ID" }]), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        : new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
    });
    vi.stubGlobal("fetch", fetchMock);
    const conn = {
      accessToken: "OLD",
      instanceUrl: "https://example.my.salesforce.com",
      refreshAuth: vi.fn().mockImplementation(async function (this: { accessToken: string }) {
        await refreshGate;
        this.accessToken = "NEW";
      }),
      request: vi.fn(),
    } as unknown as Parameters<typeof connRequest>[0];

    const first = connRequest(conn, { method: "GET", url: "/services/data/v67.0/limits" });
    const second = connRequest(conn, { method: "GET", url: "/services/data/v67.0/limits" });
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(conn.refreshAuth).toHaveBeenCalledTimes(1);
    });

    releaseRefresh();
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 200, body: { ok: true } },
      { status: 200, body: { ok: true } },
    ]);
    expect(conn.refreshAuth).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    vi.unstubAllGlobals();
  });

  test("does not refresh or replay a mutating request after a permission 403", async () => {
    const denied = [{ errorCode: "INSUFFICIENT_ACCESS", message: "denied" }];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(denied), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const conn = {
      accessToken: "TOKEN",
      instanceUrl: "https://example.my.salesforce.com",
      refreshAuth: vi.fn(),
      request: vi.fn(),
    } as unknown as Parameters<typeof connRequest>[0];

    await expect(
      connRequest(conn, {
        method: "POST",
        url: "/services/data/v67.0/sobjects/Account",
        body: { Name: "Example" },
      }),
    ).resolves.toEqual({ status: 403, body: denied });
    expect(conn.refreshAuth).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  test("preserves the original auth response when token refresh fails", async () => {
    const expired = [{ errorCode: "INVALID_SESSION_ID" }];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(expired), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const conn = {
      accessToken: "OLD",
      instanceUrl: "https://example.my.salesforce.com",
      refreshAuth: vi.fn().mockRejectedValue(new Error("refresh unavailable")),
      request: vi.fn(),
    } as unknown as Parameters<typeof connRequest>[0];

    await expect(
      connRequest(conn, { method: "GET", url: "/services/data/v67.0/limits" }),
    ).resolves.toEqual({ status: 401, body: expired });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  test("retargets the retry when auth refresh changes the instance URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ errorCode: "INVALID_SESSION_ID" }]), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const conn = {
      accessToken: "OLD",
      instanceUrl: "https://old.example.my.salesforce.com",
      refreshAuth: vi.fn().mockImplementation(function (this: {
        accessToken: string;
        instanceUrl: string;
      }) {
        this.accessToken = "NEW";
        this.instanceUrl = "https://new.example.my.salesforce.com";
        return Promise.resolve();
      }),
      request: vi.fn(),
    } as unknown as Parameters<typeof connRequest>[0];

    const response = await connRequest(conn, {
      method: "GET",
      url: "https://old.example.my.salesforce.com/services/data/v67.0/limits",
    });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("https://old.example.my.salesforce.com/");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("https://new.example.my.salesforce.com/");
    vi.unstubAllGlobals();
  });

  test("uses one total timeout across fetch, auth refresh, and retry", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify([{ errorCode: "INVALID_SESSION_ID" }]), {
                  status: 401,
                  headers: { "Content-Type": "application/json" },
                }),
              ),
            60,
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const conn = {
      accessToken: "OLD",
      instanceUrl: "https://example.my.salesforce.com",
      refreshAuth: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 60);
          }),
      ),
      request: vi.fn(),
    } as unknown as Parameters<typeof connRequest>[0];

    const pending = connRequest(conn, {
      method: "GET",
      url: "/services/data/v67.0/limits",
      timeoutMs: 100,
    });
    await vi.advanceTimersByTimeAsync(60);
    await vi.advanceTimersByTimeAsync(40);

    await expect(pending).resolves.toMatchObject({
      status: 408,
      body: { errorCode: "REQUEST_TIMEOUT" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

describe("connRequest error → status mapping", () => {
  test("prefers a numeric statusCode when present", async () => {
    const conn = throwingConn({ statusCode: 503, message: "oops" });
    const r = await connRequest(conn, { method: "GET", url: "/x" });
    expect(r.status).toBe(503);
  });

  test("maps Salesforce errorCode strings (NOT_FOUND → 404, no statusCode)", async () => {
    // jsforce throws with `errorCode: 'NOT_FOUND'` and no statusCode for /ssot
    // misses; without this mapping connRequest used to report 500 and
    // downstream tools couldn't tell a 404 from a real server error.
    const conn = throwingConn({
      errorCode: "NOT_FOUND",
      name: "NOT_FOUND",
      message: "The requested resource does not exist",
    });
    const r = await connRequest(conn, { method: "GET", url: "/x" });
    expect(r.status).toBe(404);
  });

  test("maps INVALID_SESSION_ID → 401", async () => {
    const conn = throwingConn({ errorCode: "INVALID_SESSION_ID", message: "..." });
    const r = await connRequest(conn, { method: "GET", url: "/x" });
    expect(r.status).toBe(401);
  });

  test("maps REQUEST_LIMIT_EXCEEDED → 429", async () => {
    const conn = throwingConn({ errorCode: "REQUEST_LIMIT_EXCEEDED", message: "..." });
    const r = await connRequest(conn, { method: "GET", url: "/x" });
    expect(r.status).toBe(429);
  });

  test("falls back to 500 for unknown error shapes", async () => {
    const conn = throwingConn({ message: "random failure" });
    const r = await connRequest(conn, { method: "GET", url: "/x" });
    expect(r.status).toBe(500);
  });

  test("enforces a wrapper timeout when conn.request never settles", async () => {
    vi.useFakeTimers();
    const conn = fakeConn(() => new Promise(() => undefined));

    const pending = connRequest(conn, { method: "GET", url: "/x", timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(25);

    await expect(pending).resolves.toMatchObject({
      status: 408,
      body: {
        errorCode: "REQUEST_TIMEOUT",
        name: "ConnRequestTimeoutError",
      },
    });
    vi.useRealTimers();
  });

  test("returns promptly when the caller aborts an in-flight request", async () => {
    const conn = fakeConn(() => new Promise(() => undefined));
    const controller = new AbortController();

    const pending = connRequest(conn, {
      method: "GET",
      url: "/x",
      timeoutMs: 120_000,
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      status: 499,
      body: {
        errorCode: "REQUEST_ABORTED",
        name: "ConnRequestAbortedError",
      },
    });
  });

  test("does not start conn.request for pre-aborted calls", async () => {
    const conn = fakeConn(() => ({ ok: true }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      connRequest(conn, { method: "GET", url: "/x", signal: controller.signal }),
    ).resolves.toMatchObject({
      status: 499,
      body: { errorCode: "REQUEST_ABORTED" },
    });
    expect(conn.request).not.toHaveBeenCalled();
  });
});
