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
  function fakeConn(spy: (req: { body?: unknown }) => unknown) {
    return {
      request: vi.fn(async (req: { body?: unknown }) => spy(req)),
    } as unknown as Parameters<typeof connRequest>[0];
  }

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
});
