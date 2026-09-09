/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as types from "../lib/types.ts";
import { normalizeEndpoint, resolveEndpoint, resolveTokenCandidates } from "../lib/auth.ts";

const tempDirs: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeAuthFile(body: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-docs-auth-"));
  tempDirs.push(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "auth.json"), `${JSON.stringify(body)}\n`, "utf8");
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  return dir;
}

describe("sf-docs auth", () => {
  it("ships no default docs endpoint", () => {
    expect("DEFAULT_ENDPOINT" in types).toBe(false);
    expect(resolveEndpoint()).toMatchObject({ ok: false, source: "none" });
  });

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

  it("normalizes endpoints and rejects unsafe credential destinations", () => {
    expect(normalizeEndpoint("https://docs.example.test")).toEqual({
      ok: true,
      endpoint: "https://docs.example.test/",
    });
    expect(normalizeEndpoint("https://user:pass@example.test/")).toEqual({
      ok: false,
      error: "SF_DOCS_MCP_ENDPOINT must not include username or password.",
    });
    expect(normalizeEndpoint("http://example.test/")).toEqual({
      ok: false,
      error: "SF_DOCS_MCP_ENDPOINT must use HTTPS unless the host is loopback.",
    });
    expect(normalizeEndpoint("http://127.0.0.1:8787/")).toEqual({
      ok: true,
      endpoint: "http://127.0.0.1:8787/",
      warning: "SF_DOCS_MCP_ENDPOINT is using loopback HTTP.",
    });
  });

  it("fails closed when an endpoint override is invalid", () => {
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "not-a-url");
    expect(resolveEndpoint()).toEqual({
      ok: false,
      source: "env",
      error: "SF_DOCS_MCP_ENDPOINT is not a valid URL.",
    });
  });

  it("resolves a saved credential endpoint before env", () => {
    writeAuthFile({
      "sf-docs": {
        type: "api_key",
        key: "sfmcp-must-not-leak",
        env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
      },
    });
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "https://other.example.test/");
    expect(resolveEndpoint()).toEqual({
      ok: true,
      source: "pi-auth",
      endpoint: "https://docs.example.test/",
    });
  });

  it("uses the env endpoint when no saved URL exists", () => {
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "https://docs.example.test/");
    expect(resolveEndpoint()).toEqual({
      ok: true,
      source: "env",
      endpoint: "https://docs.example.test/",
    });
  });
});
