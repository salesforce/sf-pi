/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { DocsClient, redactSecrets, unwrapToolContent } from "../lib/client.ts";

describe("DocsClient", () => {
  it("posts a tools/call JSON-RPC request and unwraps tool content", async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.method).toBe("tools/call");
      expect(body.params.name).toBe("search");
      expect(body.params.arguments.query).toBe("apex");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
      return new Response(
        'event: message\ndata: {"result":{"content":[{"type":"text","text":"{\\"results\\":[{\\"title\\":\\"Apex\\"}]}"}]},"jsonrpc":"2.0","id":1}\n\n',
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch;

    const client = new DocsClient({
      endpoint: "https://example.test/",
      token: "secret-token",
      fetchImpl,
    });
    await expect(client.callTool("search", { query: "apex" })).resolves.toEqual({
      results: [{ title: "Apex" }],
    });
  });

  it("redacts tokens from HTTP errors", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("Bearer secret-token failed", { status: 401 }),
    ) as unknown as typeof fetch;
    const client = new DocsClient({
      endpoint: "https://example.test/",
      token: "secret-token",
      fetchImpl,
    });
    await expect(client.callTool("list", {})).rejects.toThrow(/Bearer \[REDACTED\]/);
  });

  it("unwraps non-json tool content as text", () => {
    expect(unwrapToolContent({ content: [{ type: "text", text: "hello" }] })).toEqual({
      text: "hello",
    });
  });

  it("redacts bearer tokens", () => {
    expect(redactSecrets("Authorization: Bearer abc123", "abc123")).toContain("Bearer [REDACTED]");
    expect(redactSecrets("abc123", "abc123")).toBe("[REDACTED]");
  });
});
