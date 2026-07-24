/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proof for secure Pi-owned SF Docs credentials. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore, createModels } from "@earendil-works/pi-ai";
import { createSfDocsAuthController } from "../lib/auth.ts";
import type { SecureCredentialPromptBridge } from "../../../lib/common/secure-credential-prompt.ts";
import { createSfDocsConnectPanel } from "../lib/manager-action-panels.ts";
import { buildStatus } from "../lib/status.ts";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SF Docs credential security", () => {
  it("reports the credential source without rendering token material", () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-status-containment-"));
    const secret = "sfmcp_should-never-appear-in-status";
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
    vi.stubEnv("SF_DOCS_MCP_TOKEN", secret);

    try {
      const status = buildStatus("/tmp/sf-pi-test");

      expect(status).toContain("Token source: env");
      expect(status).not.toMatch(/^Token:/m);
      expect(status).not.toContain(secret);
      expect(status).not.toContain("sfmcp_");
    } finally {
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("prepares masked native login without accepting or echoing token input", async () => {
    const secret = "sfmcp_should-never-render";
    const done = vi.fn();
    const prepareLogin = vi.fn(() => "Prepared /login sf-docs.");
    const panel = createSfDocsConnectPanel({ theme, done, prepareLogin });

    for (const character of secret) panel.handleInput(character);
    for (const width of [44, 100]) {
      const rendered = panel.renderContent(width).join("\n");
      const normalized = rendered.replace(/\s+/g, " ");
      expect(normalized).toContain("fixed-mask SF Pi component");
      expect(normalized).toContain("SF_DOCS_MCP_TOKEN");
      expect(normalized).toContain("Prepare native login");
      expect(normalized).not.toContain(secret);
    }
    panel.handleInput("\r");
    await vi.waitFor(() => expect(prepareLogin).toHaveBeenCalledTimes(1));
    expect(panel.renderContent(80).join("\n")).toContain("Prepared /login sf-docs.");
    expect(done).not.toHaveBeenCalled();
  });

  it("returns API-key and OAuth credentials through the shared masked bridge", async () => {
    const bridge: SecureCredentialPromptBridge = {
      bind: vi.fn(),
      clear: vi.fn(),
      prompt: vi.fn(async () => "sfmcp-secure-provider-token"),
    };
    const controller = createSfDocsAuthController(bridge);
    const stockPrompt = vi.fn();
    const interaction = {
      signal: new AbortController().signal,
      prompt: stockPrompt,
      notify: vi.fn(),
    };

    await expect(controller.provider.auth.apiKey?.login?.(interaction)).resolves.toEqual({
      type: "api_key",
      key: "sfmcp-secure-provider-token",
    });
    await expect(controller.provider.auth.oauth?.login(interaction)).resolves.toMatchObject({
      type: "oauth",
      access: "sfmcp-secure-provider-token",
    });
    expect(bridge.prompt).toHaveBeenCalledTimes(2);
    expect(stockPrompt).not.toHaveBeenCalled();
  });

  it("persists through Pi and keeps existing OAuth credentials compatible", async () => {
    const bridge: SecureCredentialPromptBridge = {
      bind: vi.fn(),
      clear: vi.fn(),
      prompt: vi.fn(async () => "sfmcp-pi-owned-token"),
    };
    const controller = createSfDocsAuthController(bridge);
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(controller.provider);

    await models.login("sf-docs", "api_key", { prompt: vi.fn(), notify: vi.fn() });
    await expect(models.getAuth("sf-docs")).resolves.toMatchObject({
      auth: { apiKey: "sfmcp-pi-owned-token" },
      source: "Pi saved credential",
    });
    await models.logout("sf-docs");
    await expect(models.getAuth("sf-docs")).resolves.toBeUndefined();

    await credentials.modify("sf-docs", async () => ({
      type: "oauth",
      access: "sfmcp-existing-oauth-token",
      refresh: "manual-token",
      expires: Date.now() + 60_000,
    }));
    await expect(models.getAuth("sf-docs")).resolves.toMatchObject({
      auth: { apiKey: "sfmcp-existing-oauth-token" },
    });
  });

  it("hands saved-credential removal to native logout without reading the token", async () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-auth-containment-"));
    const secret = "sfmcp_must-not-render";
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      path.join(agentDir, "auth.json"),
      JSON.stringify({ "sf-docs": { type: "oauth", access: secret } }),
    );
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    try {
      const mod = await import("../index.ts");
      const registerCommand = vi.fn();
      const authStorage = { login: vi.fn(), set: vi.fn(), logout: vi.fn() };
      const pi = {
        on: vi.fn(),
        registerProvider: vi.fn(),
        registerTool: vi.fn(),
        registerCommand,
        events: { on: vi.fn() },
      };
      mod.default(pi as never);
      const command = registerCommand.mock.calls.find(([name]) => name === "sf-docs")?.[1];
      const notify = vi.fn();
      const setEditorText = vi.fn();

      await command.handler("disconnect", {
        hasUI: true,
        cwd: "/tmp/sf-pi-test",
        ui: { notify, confirm: vi.fn(async () => true), setEditorText, setStatus: vi.fn() },
        modelRegistry: { authStorage },
      });

      expect(setEditorText).toHaveBeenCalledWith("/logout sf-docs");
      expect(authStorage.logout).not.toHaveBeenCalled();
      expect(notify.mock.calls.flat().join("\n")).not.toContain(secret);
    } finally {
      vi.unstubAllEnvs();
      rmSync(agentDir, { recursive: true, force: true });
    }
  });

  it("prepares native login without invoking private auth storage", async () => {
    const mod = await import("../index.ts");
    const registerCommand = vi.fn();
    const authStorage = { login: vi.fn(), set: vi.fn(), logout: vi.fn() };
    const pi = {
      on: vi.fn(),
      registerProvider: vi.fn(),
      registerTool: vi.fn(),
      registerCommand,
      events: { on: vi.fn() },
    };
    mod.default(pi as never);
    const command = registerCommand.mock.calls.find(([name]) => name === "sf-docs")?.[1];
    const notify = vi.fn();
    const setEditorText = vi.fn();

    await command.handler("connect", {
      hasUI: true,
      mode: "tui",
      cwd: "/tmp/sf-pi-test",
      ui: { notify, setEditorText, setStatus: vi.fn() },
      modelRegistry: { authStorage },
    });

    const provider = pi.registerProvider.mock.calls[0]?.[0];
    expect(provider).toMatchObject({ id: "sf-docs", name: "SF Docs" });
    expect(provider.auth.apiKey.login).toEqual(expect.any(Function));
    expect(provider.auth.oauth.login).toEqual(expect.any(Function));
    expect(provider.getModels()).toEqual([]);
    expect(authStorage.login).not.toHaveBeenCalled();
    expect(authStorage.set).not.toHaveBeenCalled();
    expect(setEditorText).toHaveBeenCalledWith("/login sf-docs");
    expect(notify.mock.calls.flat().join("\n")).toContain("fixed-mask SF Pi component");
    expect(notify.mock.calls.flat().join("\n")).toContain("SF_DOCS_MCP_TOKEN");
  });
});
