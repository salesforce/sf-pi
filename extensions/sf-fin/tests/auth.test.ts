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
  /** `/me` on the fixed regional hosts: 200 for `home`, 401 elsewhere (or a network error). */
  function meFetch(home: "us" | "eu" | "au" | "none" | "offline") {
    const hosts = {
      us: "https://api.intercom.io",
      eu: "https://api.eu.intercom.io",
      au: "https://api.au.intercom.io",
    };
    return vi.fn(async (url: string, init: RequestInit) => {
      if (home === "offline") throw new Error("ENOTFOUND");
      expect(init.redirect).toBe("error");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SENTINEL}`);
      if (home !== "none" && url === `${hosts[home]}/me`) {
        return new Response(
          JSON.stringify({
            type: "admin",
            app: { id_code: "app1", name: "Example", region: home.toUpperCase() },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ errors: [{ code: "unauthorized" }] }), { status: 401 });
    });
  }

  it("stores the masked token and the region detected from /me, with no region question", async () => {
    const promptBridge = bridge();
    const fetch = meFetch("eu");
    const controller = createSfFinAuthController(promptBridge, {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    controller.bind(UNUSED_UI, "tui");
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);
    const prompt = vi.fn(async (_prompt: AuthPrompt) => "us");
    const notify = vi.fn();

    const credential = await models.login("sf-fin", "api_key", { prompt, notify });

    expect(credential).toEqual({ type: "api_key", key: SENTINEL, env: { INTERCOM_REGION: "eu" } });
    await expect(models.getAuth("sf-fin")).resolves.toEqual({
      auth: { apiKey: SENTINEL },
      env: { INTERCOM_REGION: "eu" },
      source: "Pi saved credential",
    });
    expect(prompt).not.toHaveBeenCalled();
    expect(promptBridge.prompt).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map((c) => c[0])).toEqual([
      "https://api.intercom.io/me",
      "https://api.eu.intercom.io/me",
    ]);
    expect(JSON.stringify(notify.mock.calls)).not.toContain(SENTINEL);
  });

  it("falls back to the region question only when the Fin API cannot be reached", async () => {
    const controller = createSfFinAuthController(bridge(), {
      fetch: meFetch("offline") as unknown as typeof globalThis.fetch,
    });
    controller.bind(UNUSED_UI, "tui");
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);
    const prompt = vi.fn(async (_prompt: AuthPrompt) => "au");

    const credential = await models.login("sf-fin", "api_key", { prompt, notify: vi.fn() });

    expect(credential).toMatchObject({ env: { INTERCOM_REGION: "au" } });
    const regionPrompt = prompt.mock.calls[0]?.[0];
    if (regionPrompt?.type !== "select") throw new Error("expected a select prompt");
    expect(regionPrompt.options.map((option) => option.id)).toEqual(["us", "eu", "au"]);
    expect(JSON.stringify(prompt.mock.calls)).not.toContain(SENTINEL);
  });

  it("rejects a token every region refuses, before Pi persists anything", async () => {
    const controller = createSfFinAuthController(bridge(), {
      fetch: meFetch("none") as unknown as typeof globalThis.fetch,
    });
    controller.bind(UNUSED_UI, "tui");
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);
    const prompt = vi.fn(async (_prompt: AuthPrompt) => "us");

    await expect(models.login("sf-fin", "api_key", { prompt, notify: vi.fn() })).rejects.toThrow(
      /rejected by the US, EU, and AU/,
    );
    await expect(models.getAuth("sf-fin")).resolves.toBeUndefined();
    expect(prompt).not.toHaveBeenCalled();
  });

  it("uses per-workspace sign-in names; env fallbacks apply only to the default workspace", async () => {
    const controller = createSfFinAuthController(bridge(), {
      workspace: "test",
      fetch: meFetch("us") as unknown as typeof globalThis.fetch,
    });
    expect(controller.provider.id).toBe("sf-fin-test");
    const models = createModels({ credentials: new InMemoryCredentialStore() });
    models.setProvider(controller.provider);
    await expect(
      models.getAuth("sf-fin-test", { env: { INTERCOM_TOKEN: "env-token-1234" } }),
    ).resolves.toBeUndefined();
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
