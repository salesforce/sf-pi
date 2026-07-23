/* SPDX-License-Identifier: Apache-2.0 */
/** Exact Pi 0.81 runtime proof that Gateway metadata never owns thinking selection. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RpcClient } from "@earendil-works/pi-coding-agent";

import { PROVIDER_NAME } from "../lib/config.ts";

const tempDirs: string[] = [];
const repoRoot = path.resolve(import.meta.dirname, "../../..");
const cliPath = path.join(
  repoRoot,
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "cli.js",
);
const extensionPath = path.join(repoRoot, "extensions", "sf-llm-gateway-internal", "index.ts");

interface RuntimeHarness {
  client: RpcClient;
  settingsPath: string;
  stop(): Promise<void>;
}

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function readSettings(settingsPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function startRuntime(
  thinkingLevel: "low" | "max",
  extraEnv: Record<string, string> = {},
): Promise<RuntimeHarness> {
  const cwd = tempDir("sf-pi-thinking-runtime-cwd-");
  const agentDir = tempDir("sf-pi-thinking-runtime-agent-");
  const settingsPath = path.join(agentDir, "settings.json");
  writeFileSync(
    settingsPath,
    `${JSON.stringify({
      defaultProvider: PROVIDER_NAME,
      defaultModel: "gpt-5.6-sol",
      defaultThinkingLevel: thinkingLevel,
    })}\n`,
    "utf8",
  );

  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gatewayPort = (server.address() as AddressInfo).port;
  writeFileSync(
    path.join(agentDir, "sf-llm-gateway-internal.json"),
    `${JSON.stringify({
      enabled: true,
      baseUrl: `http://127.0.0.1:${gatewayPort}`,
      apiKey: "test-key",
    })}\n`,
    "utf8",
  );

  const client = new RpcClient({
    cliPath,
    cwd,
    env: { PI_CODING_AGENT_DIR: agentDir, ...extraEnv },
    provider: PROVIDER_NAME,
    model: "gpt-5.6-sol",
    args: [
      "--offline",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-session",
      "--thinking",
      thinkingLevel,
      "-e",
      extensionPath,
    ],
  });
  await client.start();

  return {
    client,
    settingsPath,
    async stop() {
      await client.stop();
      await closeServer(server);
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Gateway thinking ownership through real Pi", () => {
  it("preserves low across startup, commands, and Gateway model switches", async () => {
    const runtime = await startRuntime("low");
    const { client, settingsPath } = runtime;
    try {
      expect((await client.getState()).thinkingLevel).toBe("low");
      expect(await client.getAvailableThinkingLevels()).toContain("max");

      for (const command of [
        "/sf-llm-gateway set-default global",
        "/sf-llm-gateway off global",
        "/sf-llm-gateway on global",
      ]) {
        await client.prompt(command);
        expect((await client.getState()).thinkingLevel, command).toBe("low");
        expect(readSettings(settingsPath).defaultThinkingLevel, command).toBe("low");
      }

      await client.setModel(PROVIDER_NAME, "gpt-5");
      expect((await client.getState()).thinkingLevel).toBe("low");
      const highCeilingLevels = await client.getAvailableThinkingLevels();
      expect(highCeilingLevels).toContain("xhigh");
      expect(highCeilingLevels).not.toContain("max");

      await client.setModel(PROVIDER_NAME, "gpt-5.6-sol");
      expect((await client.getState()).thinkingLevel).toBe("low");
      expect(await client.getAvailableThinkingLevels()).toContain("max");
    } finally {
      await runtime.stop();
    }

    expect(readSettings(settingsPath).defaultThinkingLevel).toBe("low");
  }, 30_000);

  it("allows Pi to clamp max when off switches to a lower-capability model", async () => {
    const runtime = await startRuntime("max", { OPENAI_API_KEY: "test-openai-key" });
    const { client, settingsPath } = runtime;
    try {
      expect((await client.getState()).thinkingLevel).toBe("max");

      await client.prompt("/sf-llm-gateway off global");
      const offState = await client.getState();
      expect(offState.model).toMatchObject({ provider: "openai", id: "gpt-5" });
      expect(offState.thinkingLevel).toBe("high");
      expect(readSettings(settingsPath).defaultThinkingLevel).toBe("high");

      await client.prompt("/sf-llm-gateway on global");
      const onState = await client.getState();
      expect(onState.model).toMatchObject({ provider: PROVIDER_NAME, id: "gpt-5.6-sol" });
      expect(onState.thinkingLevel).toBe("high");
      expect(readSettings(settingsPath).defaultThinkingLevel).toBe("high");
    } finally {
      await runtime.stop();
    }
  }, 30_000);
});
