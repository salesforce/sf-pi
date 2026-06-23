/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  maskToken,
  normalizeEndpoint,
  readPiAuthToken,
  resolveTokenCandidates,
} from "../lib/auth.ts";
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

  it("reads the sf-docs token from Pi auth json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sf-docs-auth-"));
    const file = path.join(dir, "auth.json");
    writeFileSync(file, JSON.stringify({ "sf-docs": { access: "saved-token" } }));
    expect(readPiAuthToken(file)).toBe("saved-token");
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
