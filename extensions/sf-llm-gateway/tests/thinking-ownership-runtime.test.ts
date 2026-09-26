/* SPDX-License-Identifier: Apache-2.0 */
/** Exact Pi 0.81 runtime proof that Gateway metadata never owns thinking selection. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RpcClient } from "@earendil-works/pi-coding-agent";

import { API_KEY_ENV, PROVIDER_NAME } from "../lib/config.ts";
import { toProviderModelConfig } from "../lib/models.ts";

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
const extensionPath = path.join(repoRoot, "extensions", "sf-llm-gateway", "index.ts");

const DISCOVERED_PRIMARY_MODEL = "gpt-4";
const DISCOVERED_SECONDARY_MODEL = "gpt-4o";

interface RuntimeHarness {
  client: RpcClient;
  settingsPath: string;
  gatewayConfigPath: string;
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
      defaultProvider: "openai",
      defaultModel: "gpt-5",
      defaultThinkingLevel: thinkingLevel,
    })}\n`,
    "utf8",
  );

  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    if (request.url === "/v1/models") {
      response.end(
        JSON.stringify({
          data: [{ id: DISCOVERED_PRIMARY_MODEL }, { id: DISCOVERED_SECONDARY_MODEL }],
        }),
      );
      return;
    }
    if (request.url === "/v1/model/info") {
      response.end(
        JSON.stringify({
          data: [
            {
              model_name: DISCOVERED_PRIMARY_MODEL,
              model_info: {
                supports_reasoning: false,
                max_input_tokens: 200_000,
                max_output_tokens: 64_000,
              },
            },
            {
              model_name: DISCOVERED_SECONDARY_MODEL,
              model_info: {
                supports_reasoning: false,
                max_input_tokens: 128_000,
                max_output_tokens: 32_000,
              },
            },
          ],
        }),
      );
      return;
    }
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gatewayPort = (server.address() as AddressInfo).port;
  const gatewayConfigPath = path.join(agentDir, "sf-llm-gateway.json");
  writeFileSync(
    gatewayConfigPath,
    `${JSON.stringify({
      enabled: true,
      baseUrl: `http://127.0.0.1:${gatewayPort}`,
    })}\n`,
    "utf8",
  );
  const cachedModels = [DISCOVERED_PRIMARY_MODEL, DISCOVERED_SECONDARY_MODEL].map((id) => {
    const model = toProviderModelConfig(id);
    return {
      ...model,
      provider: PROVIDER_NAME,
      baseUrl:
        model.api === "openai-completions"
          ? "https://gateway.invalid/v1"
          : "https://gateway.invalid",
    };
  });
  writeFileSync(
    path.join(agentDir, "models-store.json"),
    `${JSON.stringify({
      [PROVIDER_NAME]: { models: cachedModels, checkedAt: 1 },
    })}\n`,
    "utf8",
  );

  const client = new RpcClient({
    cliPath,
    cwd,
    env: {
      PI_CODING_AGENT_DIR: agentDir,
      [API_KEY_ENV]: "active-automation-test-key",
      OPENAI_API_KEY: "test-openai-key",
      ...extraEnv,
    },
    provider: "openai",
    model: "gpt-5",
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
    gatewayConfigPath,
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

      for (const command of [
        "/sf-llm-gateway on global",
        "/sf-llm-gateway set-default global",
        "/sf-llm-gateway off global",
        "/sf-llm-gateway on global",
      ]) {
        await client.prompt(command);
        expect(readSettings(settingsPath).defaultThinkingLevel, command).toBe("low");
      }

      expect((await client.getState()).thinkingLevel).toBe("off");
      expect(await client.getAvailableThinkingLevels()).toEqual(["off"]);

      await client.setModel(PROVIDER_NAME, DISCOVERED_SECONDARY_MODEL);
      expect((await client.getState()).thinkingLevel).toBe("off");

      await client.setModel(PROVIDER_NAME, DISCOVERED_PRIMARY_MODEL);
      expect((await client.getState()).thinkingLevel).toBe("off");
      expect(await client.getAvailableThinkingLevels()).toEqual(["off"]);
    } finally {
      await runtime.stop();
    }

    expect(readSettings(settingsPath).defaultThinkingLevel).toBe("low");
  }, 30_000);

  it("chooses a configured non-gateway fallback when no previous default was saved", async () => {
    const runtime = await startRuntime("low");
    const { client, settingsPath, gatewayConfigPath } = runtime;
    try {
      await client.prompt("/sf-llm-gateway on global");
      expect((await client.getState()).model.provider).toBe(PROVIDER_NAME);

      const saved = JSON.parse(readFileSync(gatewayConfigPath, "utf8")) as Record<string, unknown>;
      delete saved.previousDefaultProvider;
      delete saved.previousDefaultModel;
      writeFileSync(gatewayConfigPath, `${JSON.stringify(saved)}\n`, "utf8");

      await client.prompt("/sf-llm-gateway off global");
      const offState = await client.getState();
      expect(offState.model.provider).not.toBe(PROVIDER_NAME);
      expect(readSettings(settingsPath)).toMatchObject({
        defaultProvider: offState.model.provider,
        defaultModel: offState.model.id,
      });
    } finally {
      await runtime.stop();
    }
  }, 30_000);

  it("restores the previous non-gateway default while leaving Pi's thinking setting user-owned", async () => {
    const runtime = await startRuntime("max");
    const { client, settingsPath } = runtime;
    try {
      expect((await client.getState()).thinkingLevel).toBe("high");

      await client.prompt("/sf-llm-gateway on global");
      const onState = await client.getState();
      expect(onState.model).toMatchObject({
        provider: PROVIDER_NAME,
        id: DISCOVERED_PRIMARY_MODEL,
      });
      expect(onState.thinkingLevel).toBe("off");

      await client.prompt("/sf-llm-gateway off global");
      const offState = await client.getState();
      expect(offState.model).toMatchObject({ provider: "openai", id: "gpt-5" });
      expect(offState.thinkingLevel).toBe("high");
      // Pi 0.84.3 keeps thinking session-scoped unless saved; the user-owned
      // settings value stays `max` even when gpt-5 resolves the session to `high`.
      expect(readSettings(settingsPath).defaultThinkingLevel).toBe("max");
    } finally {
      await runtime.stop();
    }
  }, 30_000);
});
