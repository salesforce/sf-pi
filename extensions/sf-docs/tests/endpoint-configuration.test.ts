/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for authenticated Pi-native SF Docs configuration. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSfDocsConnectPanel } from "../lib/manager-action-panels.ts";
import { buildStatus } from "../lib/status.ts";

const theme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-credential-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "");
  vi.stubEnv("SF_DOCS_MCP_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

describe("SF Docs authenticated configuration", () => {
  it("reports credential readiness without sending endpoint or token to the model", () => {
    const endpoint = "https://internal-docs.example.test/";
    const token = "sfmcp-status-private";
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", endpoint);
    vi.stubEnv("SF_DOCS_MCP_TOKEN", token);

    const status = buildStatus("/tmp/sf-pi-test");

    expect(status).toContain("Configuration: ready");
    expect(status).toContain("Token source: env");
    expect(status).toContain("Endpoint source: env");
    expect(status).toContain("Authentication: bearer token required");
    expect(status).toContain("citations: always on for answer/explain");
    expect(status).not.toContain(endpoint);
    expect(status).not.toContain(token);
  });

  it("prepares native login for endpoint plus fixed-mask token input", async () => {
    const done = vi.fn();
    const prepareLogin = vi.fn(() => "Prepared /login sf-docs.");
    const panel = createSfDocsConnectPanel({ theme, done, prepareLogin });

    const rendered = panel.renderContent(100).join("\n").replace(/\s+/g, " ");
    expect(rendered).toContain("docs endpoint URL");
    expect(rendered).toContain("fixed-mask");
    expect(rendered).toContain("SF_DOCS_MCP_TOKEN");
    panel.handleInput("\r");
    await vi.waitFor(() => expect(prepareLogin).toHaveBeenCalledTimes(1));
    expect(panel.renderContent(80).join("\n")).toContain("Prepared /login sf-docs.");
    expect(done).not.toHaveBeenCalled();
  });

  it("registers authenticated login and prepares it without private auth-store mutation", async () => {
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
    expect(provider.auth.apiKey.name).toBe("SF Docs access token");
    expect(provider.auth.oauth).toBeUndefined();
    expect(provider.getModels()).toEqual([]);
    expect(authStorage.login).not.toHaveBeenCalled();
    expect(authStorage.set).not.toHaveBeenCalled();
    expect(setEditorText).toHaveBeenCalledWith("/login sf-docs");
    expect(notify.mock.calls.flat().join("\n")).toContain("fixed-mask");
  });
});
