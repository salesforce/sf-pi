/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for endpoint-only Pi-native SF Docs configuration. */
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
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-docs-endpoint-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

describe("SF Docs endpoint-only configuration", () => {
  it("reports endpoint readiness without sending the URL to the model", () => {
    const endpoint = "https://internal-docs.example.test/";
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", endpoint);

    const status = buildStatus("/tmp/sf-pi-test");

    expect(status).toContain("Configuration: ready");
    expect(status).toContain("Endpoint source: env");
    expect(status).toContain("Authentication: not required");
    expect(status).toContain("citations: always on for answer/explain");
    expect(status).not.toContain(endpoint);
  });

  it("prepares native login without accepting a token", async () => {
    const done = vi.fn();
    const prepareLogin = vi.fn(() => "Prepared /login sf-docs.");
    const panel = createSfDocsConnectPanel({ theme, done, prepareLogin });

    const rendered = panel.renderContent(100).join("\n").replace(/\s+/g, " ");
    expect(rendered).toContain("internally supplied docs endpoint URL");
    expect(rendered).toContain("No access token is required or transmitted");
    panel.handleInput("\r");
    await vi.waitFor(() => expect(prepareLogin).toHaveBeenCalledTimes(1));
    expect(panel.renderContent(80).join("\n")).toContain("Prepared /login sf-docs.");
    expect(done).not.toHaveBeenCalled();
  });

  it("registers endpoint-only login and prepares it without private auth storage", async () => {
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
    expect(provider.auth.apiKey.name).toBe("SF Docs endpoint");
    expect(provider.auth.oauth).toBeUndefined();
    expect(provider.getModels()).toEqual([]);
    expect(authStorage.login).not.toHaveBeenCalled();
    expect(authStorage.set).not.toHaveBeenCalled();
    expect(setEditorText).toHaveBeenCalledWith("/login sf-docs");
    expect(notify.mock.calls.flat().join("\n")).toContain("No access token is required");
  });
});
