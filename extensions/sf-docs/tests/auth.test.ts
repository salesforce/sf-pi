/* SPDX-License-Identifier: Apache-2.0 */
import { InMemoryCredentialStore, createModels } from "@earendil-works/pi-ai";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as types from "../lib/types.ts";
import { createSfDocsProvider, normalizeEndpoint, resolveEndpoint } from "../lib/auth.ts";

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-auth-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function writeAuthFile(body: unknown): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "auth.json"), `${JSON.stringify(body)}\n`, "utf8");
}

describe("sf-docs endpoint configuration", () => {
  it("ships with no default docs endpoint", () => {
    expect("DEFAULT_ENDPOINT" in types).toBe(false);
    expect(resolveEndpoint()).toMatchObject({ ok: false, source: "none" });
  });

  it("stores only the endpoint through Pi-native login", async () => {
    const provider = createSfDocsProvider();
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(provider);

    const credential = await models.login("sf-docs", "api_key", {
      prompt: vi.fn(async () => "https://docs.example.test"),
      notify: vi.fn(),
    });

    expect(credential).toEqual({
      type: "api_key",
      env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
    });
    expect(credential).not.toHaveProperty("key");
    await expect(models.getAuth("sf-docs")).resolves.toMatchObject({
      auth: { baseUrl: "https://docs.example.test/" },
      env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
      source: "Pi saved endpoint",
    });
  });

  it("ignores a legacy saved key and resolves only its endpoint", async () => {
    const provider = createSfDocsProvider();
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("sf-docs", async () => ({
      type: "api_key",
      key: "legacy-value-must-not-be-used",
      env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
    }));
    const models = createModels({ credentials });
    models.setProvider(provider);

    const resolved = await models.getAuth("sf-docs");
    expect(resolved).toMatchObject({ auth: { baseUrl: "https://docs.example.test/" } });
    expect(resolved?.auth.apiKey).toBeUndefined();
  });

  it("normalizes endpoints and rejects unsafe destinations", () => {
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

  it("resolves a saved endpoint before the environment", () => {
    writeAuthFile({
      "sf-docs": {
        type: "api_key",
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

  it("uses the environment endpoint when no saved URL exists", () => {
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "https://docs.example.test/");
    expect(resolveEndpoint()).toEqual({
      ok: true,
      source: "env",
      endpoint: "https://docs.example.test/",
    });
  });
});
