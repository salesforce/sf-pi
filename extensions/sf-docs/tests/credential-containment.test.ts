/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proof for the temporary C0 credential-entry containment. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loginSfDocs } from "../lib/auth.ts";
import { createSfDocsConnectPanel } from "../lib/manager-action-panels.ts";
import { buildStatus } from "../lib/status.ts";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("SF Docs credential containment", () => {
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

  it("renders setup guidance without accepting or echoing token input", () => {
    const secret = "sfmcp_should-never-render";
    const done = vi.fn();
    const panel = createSfDocsConnectPanel({ theme, done });

    for (const character of secret) panel.handleInput(character);
    for (const width of [44, 100]) {
      const rendered = panel.renderContent(width).join("\n");
      const normalized = rendered.replace(/\s+/g, " ");
      expect(normalized).toContain("Credential entry is temporarily unavailable");
      expect(normalized).toContain("SF_DOCS_MCP_TOKEN");
      expect(normalized).toContain("rotate");
      expect(normalized).not.toContain("Paste your SF Docs MCP token");
      expect(normalized).not.toContain(secret);
    }
    expect(done).not.toHaveBeenCalled();
  });

  it("refuses provider login before requesting a visible secret", async () => {
    const onPrompt = vi.fn(async () => "sfmcp_should-never-be-requested");

    await expect(
      loginSfDocs({
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

  it("keeps /sf-docs connect visible without invoking private auth storage", async () => {
    const mod = await import("../index.ts");
    const registerCommand = vi.fn();
    const authStorage = { login: vi.fn(), set: vi.fn(), logout: vi.fn() };
    const pi = {
      registerProvider: vi.fn(),
      registerTool: vi.fn(),
      registerCommand,
      events: { on: vi.fn() },
    };
    mod.default(pi as never);
    const command = registerCommand.mock.calls.find(([name]) => name === "sf-docs")?.[1];
    const notify = vi.fn();
    const editor = vi.fn();

    await command.handler("connect", {
      hasUI: true,
      cwd: "/tmp/sf-pi-test",
      ui: { notify, editor, setStatus: vi.fn() },
      modelRegistry: { authStorage },
    });

    expect(authStorage.login).not.toHaveBeenCalled();
    expect(authStorage.set).not.toHaveBeenCalled();
    expect(editor).not.toHaveBeenCalled();
    expect(notify.mock.calls.flat().join("\n")).toContain("temporarily unavailable");
    expect(notify.mock.calls.flat().join("\n")).toContain("SF_DOCS_MCP_TOKEN");
  });
});
