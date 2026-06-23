/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { parseJsonRpcSseResponse, parseSseEvents } from "../lib/sse.ts";

describe("sf-docs SSE parser", () => {
  it("parses a single message event", () => {
    expect(parseSseEvents('event: message\ndata: {"ok":true}\n\n')).toEqual([
      { event: "message", data: '{"ok":true}' },
    ]);
  });

  it("joins multi-line data blocks", () => {
    expect(parseSseEvents('event: message\ndata: {"a":1,\ndata: "b":2}\n\n')[0]?.data).toBe(
      '{"a":1,\n"b":2}',
    );
  });

  it("parses JSON-RPC JSON from the last message event", () => {
    expect(
      parseJsonRpcSseResponse('event: message\ndata: {"result":{"ok":true},"id":1}\n\n'),
    ).toEqual({
      result: { ok: true },
      id: 1,
    });
  });

  it("throws when no data event is present", () => {
    expect(() => parseJsonRpcSseResponse("event: ping\n\n")).toThrow(/no SSE data/i);
  });
});
