/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for cached gateway model discovery registration. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { API_KEY_ENV, BASE_URL_ENV } from "../lib/config.ts";

const ORIGINAL_BASE_URL = process.env[BASE_URL_ENV];
const ORIGINAL_API_KEY = process.env[API_KEY_ENV];
const ORIGINAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

interface CapturedRegistration {
  name: string;
  config: { models?: ProviderModelConfig[] };
}

function makeFakePi(captured: CapturedRegistration[]) {
  return {
    registerProvider(name: string, config: CapturedRegistration["config"]) {
      captured.push({ name, config });
    },
    unregisterProvider() {
      // no-op
    },
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function seedDiscoveryCache(agentDir: string, modelIds: string[]): void {
  const cachePath = join(
    agentDir,
    "sf-pi",
    "sf-llm-gateway-internal",
    "model-discovery-cache.json",
  );
  mkdirSync(join(cachePath, ".."), { recursive: true });
  writeFileSync(
    cachePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        state: {
          modelIds,
          modelInfoMap: {},
          modelGroupInfo: {},
          discoveredAt: "2026-05-12T00:00:00.000Z",
          savedAt: Date.now(),
        },
      },
      null,
      2,
    ),
  );
}

describe("cached gateway discovery", () => {
  afterEach(() => {
    restoreEnv(BASE_URL_ENV, ORIGINAL_BASE_URL);
    restoreEnv(API_KEY_ENV, ORIGINAL_API_KEY);
    restoreEnv("PI_CODING_AGENT_DIR", ORIGINAL_AGENT_DIR);
    vi.resetModules();
  });

  it("registers the cached discovered model list before live discovery", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "sf-pi-gateway-discovery-cache-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";

    seedDiscoveryCache(agentDir, ["claude-opus-4-7", "gpt-5.5"]);

    const { registerCachedDiscoveryIfAvailable, getLastDiscovery } =
      await import("../lib/discovery.ts");
    const captured: CapturedRegistration[] = [];

    const registered = registerCachedDiscoveryIfAvailable(
      makeFakePi(captured) as never,
      null,
      new Set(),
      process.cwd(),
    );

    expect(registered).toBe(true);
    expect(captured).toHaveLength(1);
    const models = captured[0].config.models ?? [];
    expect(models.map((model) => model.id).sort()).toEqual(["claude-opus-4-7", "gpt-5.5"]);
    expect(getLastDiscovery()).toMatchObject({
      source: "gateway",
      modelIds: expect.arrayContaining(["claude-opus-4-7", "gpt-5.5"]),
    });
  });

  it("can register the cache during factory startup without a session cwd", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "sf-pi-gateway-discovery-cache-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env[BASE_URL_ENV] = "https://gateway.example.test";
    process.env[API_KEY_ENV] = "test-key";
    seedDiscoveryCache(agentDir, ["gemini-3-pro-preview"]);

    const { registerCachedDiscoveryIfAvailable } = await import("../lib/discovery.ts");
    const captured: CapturedRegistration[] = [];

    const registered = registerCachedDiscoveryIfAvailable(
      makeFakePi(captured) as never,
      null,
      new Set(),
    );

    expect(registered).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].config.models?.map((model) => model.id)).toEqual(["gemini-3-pro-preview"]);
  });
});
