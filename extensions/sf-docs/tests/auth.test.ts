/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { maskToken, normalizeEndpoint, resolveTokenCandidates } from "../lib/auth.ts";

describe("sf-docs auth", () => {
  it("resolves pi auth before env", () => {
    expect(resolveTokenCandidates({ piAuthToken: "pi", envToken: "env" })).toEqual({
      source: "pi-auth",
      token: "pi",
    });
  });

  it("falls back to env token", () => {
    expect(resolveTokenCandidates({ piAuthToken: "", envToken: "env" })).toEqual({
      source: "env",
      token: "env",
    });
  });

  it("masks tokens", () => {
    expect(maskToken("sfmcp_abcdefghijklmnopqrstuvwxyz")).toBe("sfmcp_…vwxyz");
  });

  it("normalizes endpoints and rejects userinfo", () => {
    expect(normalizeEndpoint("https://mcp.docs.salesforce.com")).toEqual({
      ok: true,
      endpoint: "https://mcp.docs.salesforce.com/",
    });
    expect(normalizeEndpoint("https://user:pass@example.test/")).toEqual({
      ok: false,
      error: "SF_DOCS_MCP_ENDPOINT must not include username or password.",
    });
  });
});
