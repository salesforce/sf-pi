/* SPDX-License-Identifier: Apache-2.0 */
import { InMemoryCredentialStore, createModels, type AuthPrompt } from "@earendil-works/pi-ai";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecureCredentialPromptBridge } from "../../../lib/common/secure-credential-prompt.ts";
import {
  createSfFinAuthController,
  detectRegion,
  detectTokenSource,
  hasStoredFinCredential,
  normalizeRegion,
} from "../lib/auth.ts";

const UNUSED_UI = {} as ExtensionUIContext;
const SENTINEL = "fin-sentinel-token-0000";
let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-fin-auth-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("INTERCOM_TOKEN", "");
  vi.stubEnv("INTERCOM_REGION", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function bridge(token = SENTINEL): SecureCredentialPromptBridge {
  return {
    bind: vi.fn(() => undefined),
    clear: vi.fn(() => undefined),
    prompt: vi.fn(async () => token),
  };
}

function writeAuthFile(body: unknown): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "auth.json"), `${JSON.stringify(body)}\n`, "utf8");
}

describe("sf-fin Pi-owned credential", () => {
  it("stores the masked token and selected region through native login", async () => {
    const promptBridge = bridge();
    const controller = createSfFinAuthController(promptBridge);
    controller.bind(UNUSED_UI, "tui");
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);
    const prompt = vi.fn(async (_prompt: AuthPrompt) => "us");

    const credential = await models.login("sf-fin", "api_key", { prompt, notify: vi.fn() });

    expect(credential).toEqual({ type: "api_key", key: SENTINEL, env: { INTERCOM_REGION: "us" } });
    await expect(models.getAuth("sf-fin")).resolves.toEqual({
      auth: { apiKey: SENTINEL },
      env: { INTERCOM_REGION: "us" },
      source: "Pi saved credential",
    });
    // The region is a select prompt; the token goes only through the masked bridge.
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(prompt.mock.calls[0]?.[0]).toMatchObject({ type: "select" });
    expect(promptBridge.prompt).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(prompt.mock.calls)).not.toContain(SENTINEL);
  });

  it("offers US first by default and rejects unknown regions", async () => {
    const controller = createSfFinAuthController(bridge());
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);
    const prompt = vi.fn(async (_prompt: AuthPrompt) => "mars");

    await expect(models.login("sf-fin", "api_key", { prompt, notify: vi.fn() })).rejects.toThrow(
      /Unsupported Fin region/,
    );
    const regionPrompt = prompt.mock.calls[0]?.[0];
    if (regionPrompt?.type !== "select") throw new Error("expected a select prompt");
    const options = regionPrompt.options;
    expect(options.map((option) => option.id)).toEqual(["us", "eu", "au"]);
  });

  it("falls back to INTERCOM_TOKEN / INTERCOM_REGION for automation", async () => {
    const controller = createSfFinAuthController(bridge());
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);

    await expect(
      models.getAuth("sf-fin", {
        env: { INTERCOM_TOKEN: "env-token-1234", INTERCOM_REGION: "EU" },
      }),
    ).resolves.toEqual({
      auth: { apiKey: "env-token-1234" },
      env: { INTERCOM_REGION: "eu" },
      source: "INTERCOM_TOKEN",
    });
    await expect(models.getAuth("sf-fin", { env: {} })).resolves.toBeUndefined();
  });

  it("reports credential source and region from status-only inspection without the token", () => {
    expect(detectTokenSource()).toBe("none");
    expect(detectRegion()).toEqual({ region: "us", source: "default" });

    writeAuthFile({ "sf-fin": { type: "api_key", key: SENTINEL, env: { INTERCOM_REGION: "au" } } });
    expect(detectTokenSource()).toBe("pi-auth");
    expect(hasStoredFinCredential()).toBe(true);
    expect(detectRegion()).toEqual({ region: "au", source: "pi-auth" });
    expect(JSON.stringify(detectRegion())).not.toContain(SENTINEL);
  });

  it("normalizes regions", () => {
    expect(normalizeRegion(" US ")).toBe("us");
    expect(normalizeRegion("eu")).toBe("eu");
    expect(normalizeRegion("apac")).toBeUndefined();
    expect(normalizeRegion(undefined)).toBeUndefined();
  });
});
