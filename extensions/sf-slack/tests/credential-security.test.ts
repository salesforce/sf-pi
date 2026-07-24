/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proof for secure Pi-owned SF Slack credentials. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCredentialStore, createModels } from "@earendil-works/pi-ai";
import { createSfSlackAuthController } from "../lib/auth.ts";
import type { SecureCredentialPromptBridge } from "../../../lib/common/secure-credential-prompt.ts";
import { createSlackConnectPanel } from "../lib/manager-action-panels.ts";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function eventBus() {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  return {
    on(event: string, handler: (payload: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    emit(event: string, payload: unknown) {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SF Slack credential security", () => {
  it("prepares masked native login without accepting or echoing token input", async () => {
    const secret = "xoxp-should-never-render";
    const done = vi.fn();
    const prepareLogin = vi.fn(() => "Prepared /login sf-slack, then /sf-slack refresh.");
    const panel = createSlackConnectPanel({ theme, done, prepareLogin });

    for (const character of secret) panel.handleInput(character);
    for (const width of [44, 100]) {
      const rendered = panel.renderContent(width).join("\n");
      const normalized = rendered.replace(/\s+/g, " ");
      expect(normalized).toContain("fixed-mask SF Pi component");
      expect(normalized).toContain("SLACK_USER_TOKEN");
      expect(normalized).toContain("Prepare native login");
      expect(normalized).not.toContain(secret);
    }
    panel.handleInput("\r");
    await vi.waitFor(() => expect(prepareLogin).toHaveBeenCalledTimes(1));
    expect(panel.renderContent(80).join("\n")).toContain("/sf-slack refresh");
    expect(done).not.toHaveBeenCalled();
  });

  it("returns API-key and OAuth credentials through the shared masked bridge", async () => {
    const bridge: SecureCredentialPromptBridge = {
      bind: vi.fn(),
      clear: vi.fn(),
      prompt: vi.fn(async () => "xoxp-secure-provider-token"),
    };
    const controller = createSfSlackAuthController(bridge);
    const stockPrompt = vi.fn();
    const interaction = {
      signal: new AbortController().signal,
      prompt: stockPrompt,
      notify: vi.fn(),
    };

    await expect(controller.provider.auth.apiKey?.login?.(interaction)).resolves.toEqual({
      type: "api_key",
      key: "xoxp-secure-provider-token",
    });
    await expect(controller.provider.auth.oauth?.login(interaction)).resolves.toMatchObject({
      type: "oauth",
      access: "xoxp-secure-provider-token",
    });
    expect(bridge.prompt).toHaveBeenCalledTimes(2);
    expect(stockPrompt).not.toHaveBeenCalled();
  });

  it("persists through Pi and keeps existing OAuth credentials compatible", async () => {
    const bridge: SecureCredentialPromptBridge = {
      bind: vi.fn(),
      clear: vi.fn(),
      prompt: vi.fn(async () => "xoxp-pi-owned-token"),
    };
    const controller = createSfSlackAuthController(bridge);
    const credentials = new InMemoryCredentialStore();
    const models = createModels({ credentials });
    models.setProvider(controller.provider);

    await models.login("sf-slack", "api_key", { prompt: vi.fn(), notify: vi.fn() });
    await expect(models.getAuth("sf-slack")).resolves.toMatchObject({
      auth: { apiKey: "xoxp-pi-owned-token" },
      source: "Pi saved credential",
    });
    await models.logout("sf-slack");
    await expect(models.getAuth("sf-slack")).resolves.toBeUndefined();

    await credentials.modify("sf-slack", async () => ({
      type: "oauth",
      access: "xoxp-existing-oauth-token",
      refresh: "manual-token",
      expires: Date.now() + 60_000,
    }));
    await expect(models.getAuth("sf-slack")).resolves.toMatchObject({
      auth: { apiKey: "xoxp-existing-oauth-token" },
    });
  });

  it("hands saved-credential removal to native logout without reading the token", async () => {
    const agentDir = mkdtempSync(path.join(tmpdir(), "sf-slack-auth-containment-"));
    const secret = "xoxp-must-not-render";
    writeFileSync(
      path.join(agentDir, "auth.json"),
      JSON.stringify({ "sf-slack": { type: "oauth", access: secret } }),
    );
    vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);

    try {
      const mod = await import("../index.ts");
      const registerCommand = vi.fn();
      const authStorage = { login: vi.fn(), set: vi.fn(), logout: vi.fn() };
      const pi = {
        events: eventBus(),
        on: vi.fn(),
        registerCommand,
        registerProvider: vi.fn(),
        appendEntry: vi.fn(),
      };
      mod.default(pi as never);
      const command = registerCommand.mock.calls.find(([name]) => name === "sf-slack")?.[1];
      const notify = vi.fn();
      const setEditorText = vi.fn();

      await command.handler("disconnect", {
        hasUI: true,
        cwd: "/tmp/sf-pi-test",
        ui: {
          notify,
          confirm: vi.fn(async () => true),
          setEditorText,
          setStatus: vi.fn(),
          setWidget: vi.fn(),
        },
        modelRegistry: { authStorage },
      });

      expect(setEditorText).toHaveBeenCalledWith("/logout sf-slack");
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
    const authStorage = {
      login: vi.fn(async () => {
        throw new Error("private auth storage should not run");
      }),
      set: vi.fn(),
      logout: vi.fn(),
    };
    const pi = {
      events: eventBus(),
      on: vi.fn(),
      registerCommand,
      registerProvider: vi.fn(),
      appendEntry: vi.fn(),
    };
    mod.default(pi as never);
    const command = registerCommand.mock.calls.find(([name]) => name === "sf-slack")?.[1];
    const notify = vi.fn();
    const setEditorText = vi.fn();

    await command.handler("connect", {
      hasUI: true,
      mode: "tui",
      cwd: "/tmp/sf-pi-test",
      ui: { notify, setEditorText, setStatus: vi.fn(), setWidget: vi.fn() },
      modelRegistry: { authStorage },
    });

    const provider = pi.registerProvider.mock.calls[0]?.[0];
    expect(provider).toMatchObject({ id: "sf-slack", name: "SF Slack" });
    expect(provider.auth.apiKey.login).toEqual(expect.any(Function));
    expect(provider.auth.oauth.login).toEqual(expect.any(Function));
    expect(provider.getModels()).toEqual([]);
    expect(authStorage.login).not.toHaveBeenCalled();
    expect(authStorage.set).not.toHaveBeenCalled();
    expect(setEditorText).toHaveBeenCalledWith("/login sf-slack");
    expect(notify.mock.calls.flat().join("\n")).toContain("fixed-mask SF Pi component");
    expect(notify.mock.calls.flat().join("\n")).toContain("/sf-slack refresh");
    expect(notify.mock.calls.flat().join("\n")).toContain("SLACK_USER_TOKEN");
  });
});
