/* SPDX-License-Identifier: Apache-2.0 */
import { InMemoryCredentialStore, createModels } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as types from "../lib/types.ts";
import {
  createSfDocsAuthController,
  detectTokenSource,
  normalizeEndpoint,
  resolveEndpoint,
} from "../lib/auth.ts";
import type { SecureCredentialPromptBridge } from "../../../lib/common/secure-credential-prompt.ts";

const UNUSED_UI = {} as ExtensionUIContext;
let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-auth-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "");
  vi.stubEnv("SF_DOCS_MCP_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function writeAuthFile(body: unknown): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "auth.json"), `${JSON.stringify(body)}\n`, "utf8");
}

function makePromptBridge(token = "sfmcp-test-token"): SecureCredentialPromptBridge {
  return {
    bind: vi.fn((_ui: ExtensionUIContext, _mode: ExtensionContext["mode"]) => undefined),
    clear: vi.fn(() => undefined),
    prompt: vi.fn(async () => token),
  };
}

describe("sf-docs authenticated configuration", () => {
  it("ships with no default docs endpoint", () => {
    expect("DEFAULT_ENDPOINT" in types).toBe(false);
    expect(resolveEndpoint()).toMatchObject({ ok: false, source: "none" });
  });

  it("stores the masked token and endpoint through Pi-native login", async () => {
    const bridge = makePromptBridge("sfmcp-pi-owned-token");
    const controller = createSfDocsAuthController(bridge);
    controller.bind(UNUSED_UI, "tui");
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(controller.provider);
    const prompt = vi.fn(async () => "https://docs.example.test");

    const credential = await models.login("sf-docs", "api_key", {
      prompt,
      notify: vi.fn(),
    });

    expect(credential).toEqual({
      type: "api_key",
      key: "sfmcp-pi-owned-token",
      env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
    });
    await expect(models.getAuth("sf-docs")).resolves.toMatchObject({
      auth: {
        apiKey: "sfmcp-pi-owned-token",
        baseUrl: "https://docs.example.test/",
      },
      env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
      source: "Pi saved credential",
    });
    expect(bridge.prompt).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prompt.mock.calls)).not.toContain("sfmcp-pi-owned-token");
  });

  it("treats a legacy endpoint-only credential as incomplete setup", async () => {
    const controller = createSfDocsAuthController(makePromptBridge());
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("sf-docs", async () => ({
      type: "api_key",
      env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
    }));
    const models = createModels({ credentials });
    models.setProvider(controller.provider);

    await expect(models.getAuth("sf-docs")).resolves.toBeUndefined();

    writeAuthFile({
      "sf-docs": {
        type: "api_key",
        env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
      },
    });
    expect(detectTokenSource()).toBe("none");
    expect(resolveEndpoint()).toMatchObject({ ok: true, source: "pi-auth" });
  });

  it("uses the environment token and endpoint for automation", async () => {
    const controller = createSfDocsAuthController(makePromptBridge());
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);

    const resolved = await models.getAuth("sf-docs", {
      env: {
        SF_DOCS_MCP_TOKEN: "sfmcp-env-token",
        SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/",
      },
    });

    expect(resolved).toEqual({
      auth: {
        apiKey: "sfmcp-env-token",
        baseUrl: "https://docs.example.test/",
      },
      env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
      source: "SF_DOCS_MCP_TOKEN",
    });
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
        key: "sfmcp-test-token",
        env: { SF_DOCS_MCP_ENDPOINT: "https://docs.example.test/" },
      },
    });
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "https://other.example.test/");
    expect(resolveEndpoint()).toEqual({
      ok: true,
      source: "pi-auth",
      endpoint: "https://docs.example.test/",
    });
    expect(detectTokenSource()).toBe("pi-auth");
  });
});
