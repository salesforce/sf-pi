/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proof for the temporary C0 credential-entry containment. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loginSlack } from "../lib/auth.ts";
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

describe("SF Slack credential containment", () => {
  it("renders setup guidance without accepting or echoing token input", () => {
    const secret = "xoxp-should-never-render";
    const done = vi.fn();
    const panel = createSlackConnectPanel({ theme, done });

    for (const character of secret) panel.handleInput(character);
    for (const width of [44, 100]) {
      const rendered = panel.renderContent(width).join("\n");
      const normalized = rendered.replace(/\s+/g, " ");
      expect(normalized).toContain("Credential entry is temporarily unavailable");
      expect(normalized).toContain("SLACK_USER_TOKEN");
      expect(normalized).toContain("rotate");
      expect(normalized).not.toContain("Paste a Slack user token");
      expect(normalized).not.toContain(secret);
    }
    expect(done).not.toHaveBeenCalled();
  });

  it("refuses provider login before requesting a visible token or callback URL", async () => {
    vi.stubEnv("SLACK_CLIENT_ID", "");
    vi.stubEnv("SLACK_CLIENT_SECRET", "");
    vi.stubEnv("SLACK_REDIRECT_URI", "");
    const onPrompt = vi.fn(async () => "xoxp-should-never-be-requested");

    await expect(
      loginSlack({
        onAuth: vi.fn(),
        onPrompt,
        onProgress: vi.fn(),
        onDeviceCode: vi.fn(),
        onSelect: vi.fn(),
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(onPrompt).not.toHaveBeenCalled();
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

  it("keeps /sf-slack connect visible without invoking private auth storage", async () => {
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
    const editor = vi.fn();

    await command.handler("connect", {
      hasUI: true,
      cwd: "/tmp/sf-pi-test",
      ui: { notify, editor, setStatus: vi.fn(), setWidget: vi.fn() },
      modelRegistry: { authStorage },
    });

    expect(authStorage.login).not.toHaveBeenCalled();
    expect(authStorage.set).not.toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
    expect(notify.mock.calls.flat().join("\n")).toContain("temporarily unavailable");
    expect(notify.mock.calls.flat().join("\n")).toContain("SLACK_USER_TOKEN");
  });
});
