/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin Agent API key safety Behavior Proofs (the ADR 0087 credential set plus
 * Agent API separation and transport rules).
 */
import { InMemoryCredentialStore, createModels, type AuthPrompt } from "@earendil-works/pi-ai";
import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SecureCredentialPromptBridge } from "../../../lib/common/secure-credential-prompt.ts";
import { createAgentApiClient, probeAgentApiAccess } from "../lib/agent-api.ts";
import {
  agentKeyCachedCheck,
  agentKeyShapeIssue,
  agentKeyStatusLines,
  createAgentKeyStatusStore,
  detectAgentKeySource,
  sameSecret,
} from "../lib/agent-key.ts";
import { createSfFinAgentAuthController } from "../lib/auth.ts";
import { buildDebugBundle } from "../lib/debug.ts";
import { createFinService } from "../lib/service.ts";

const UNUSED_UI = {} as ExtensionUIContext;
const AGENT_KEY = "fin-agent-sentinel-key-000000000000";
const PERSONAL = "fin-personal-sentinel-token-11111111";
let agentDir: string;

beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-fin-agent-key-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("FIN_AGENT_API_KEY", "");
  vi.stubEnv("INTERCOM_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(agentDir, { recursive: true, force: true });
});

function bridge(value: string): SecureCredentialPromptBridge {
  return { bind: vi.fn(), clear: vi.fn(), prompt: vi.fn(async () => value) };
}
function writeAuth(body: unknown): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, "auth.json"), `${JSON.stringify(body)}\n`, "utf8");
}
function modelsWith(value: string) {
  const promptBridge = bridge(value);
  const controller = createSfFinAgentAuthController(promptBridge);
  controller.bind(UNUSED_UI, "tui");
  const models = createModels({ credentials: new InMemoryCredentialStore() });
  models.setProvider(controller.provider);
  return { models, promptBridge };
}
const noPrompt = vi.fn(async (_p: AuthPrompt) => "");

describe("Fin Agent API key storage", () => {
  it("stores the masked key under its own provider, trimmed, with no other prompt", async () => {
    const { models, promptBridge } = modelsWith(`  ${AGENT_KEY}  `);
    const credential = await models.login("sf-fin-agent", "api_key", {
      prompt: noPrompt,
      notify: vi.fn(),
    });
    expect(credential).toEqual({ type: "api_key", key: AGENT_KEY });
    await expect(models.getAuth("sf-fin-agent")).resolves.toMatchObject({
      auth: { apiKey: AGENT_KEY },
      source: "Pi saved credential",
    });
    expect(promptBridge.prompt).toHaveBeenCalledTimes(1);
    expect(noPrompt).not.toHaveBeenCalled();
  });

  it("rejects the personal API token at login, before Pi persists anything", async () => {
    writeAuth({ "sf-fin": { type: "api_key", key: PERSONAL } });
    const { models } = modelsWith(PERSONAL);
    await expect(
      models.login("sf-fin-agent", "api_key", { prompt: noPrompt, notify: vi.fn() }),
    ).rejects.toThrow(/personal API token/);
    await expect(models.getAuth("sf-fin-agent")).resolves.toBeUndefined();
  });

  it("rejects malformed pastes: empty, Bearer-prefixed, multi-line, too short", async () => {
    for (const bad of ["   ", `Bearer ${AGENT_KEY}`, `${AGENT_KEY}\nextra`, "short"]) {
      const { models } = modelsWith(bad);
      await expect(
        models.login("sf-fin-agent", "api_key", { prompt: noPrompt, notify: vi.fn() }),
      ).rejects.toThrow();
    }
    expect(agentKeyShapeIssue(AGENT_KEY)).toBeUndefined();
  });

  it("falls back to FIN_AGENT_API_KEY for automation", async () => {
    const { models } = modelsWith(AGENT_KEY);
    await expect(
      models.getAuth("sf-fin-agent", { env: { FIN_AGENT_API_KEY: AGENT_KEY } }),
    ).resolves.toMatchObject({ auth: { apiKey: AGENT_KEY }, source: "FIN_AGENT_API_KEY" });
    await expect(models.getAuth("sf-fin-agent", { env: {} })).resolves.toBeUndefined();
  });

  it("detects the key source for status without returning the value", () => {
    expect(detectAgentKeySource({})).toBe("none");
    expect(detectAgentKeySource({ FIN_AGENT_API_KEY: AGENT_KEY })).toBe("env");
    writeAuth({ "sf-fin-agent": { type: "api_key", key: AGENT_KEY } });
    expect(detectAgentKeySource({})).toBe("pi-auth");
    const text = agentKeyStatusLines({}, "pi-auth").join("\n");
    expect(text).toContain("/login sf-fin-agent");
    expect(text).not.toContain(AGENT_KEY);
  });

  it("compares secrets in constant time and never matches empties", () => {
    expect(sameSecret(AGENT_KEY, ` ${AGENT_KEY} `)).toBe(true);
    expect(sameSecret(AGENT_KEY, PERSONAL)).toBe(false);
    expect(sameSecret("", "")).toBe(false);
    expect(sameSecret(undefined, AGENT_KEY)).toBe(false);
  });
});

describe("Fin Agent API key separation and transport", () => {
  function ctxWith(keys: { agent?: string; personal?: string }) {
    return {
      cwd: agentDir,
      modelRegistry: {
        getProviderAuth: vi.fn(async (provider: string) => {
          const key = provider === "sf-fin-agent" ? keys.agent : keys.personal;
          return key ? { auth: { apiKey: key }, env: { INTERCOM_REGION: "us" } } : undefined;
        }),
      },
    };
  }

  it("refuses to send a key equal to the personal token, from any source", async () => {
    const fetch = vi.fn();
    const store = createAgentKeyStatusStore(path.join(agentDir, "agent-status.json"));
    const service = createFinService({
      exec: vi.fn(),
      agentDeps: { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} },
      agentStatusStore: store,
    });
    const result = await service.agent(ctxWith({ agent: PERSONAL, personal: PERSONAL }) as never, {
      operation: "access",
    });
    expect(result.ok).toBe(false);
    expect(result.details).toMatchObject({ access: "same_as_personal_token" });
    expect(fetch).not.toHaveBeenCalled();
    expect(store.read().lastAccess).toBe("same_as_personal_token");
    expect(result.text).not.toContain(PERSONAL);
  });

  it("sends the key only as a Bearer header to the fixed regional host, refusing redirects", async () => {
    const fetch = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    for (const [region, host] of [
      ["us", "https://api.intercom.io/fin/mcp"],
      ["eu", "https://api.eu.intercom.io/fin/mcp"],
      ["au", "https://api.au.intercom.io/fin/mcp"],
    ] as const) {
      fetch.mockClear();
      const client = createAgentApiClient({
        key: AGENT_KEY,
        region,
        deps: { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} },
      });
      await probeAgentApiAccess(client);
      const [url, init] = fetch.mock.calls[0]!;
      expect(url).toBe(host);
      expect(init.redirect).toBe("error");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${AGENT_KEY}`);
      expect(String(init.body)).not.toContain(AGENT_KEY);
      expect(url).not.toContain(AGENT_KEY);
    }
  });

  it("records only the access outcome; status and doctor files contain no key material", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "ask_fin" }] } }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const store = createAgentKeyStatusStore(path.join(agentDir, "agent-status.json"));
    const service = createFinService({
      exec: vi.fn(),
      agentDeps: { fetch: fetch as unknown as typeof globalThis.fetch, sleep: async () => {} },
      agentStatusStore: store,
    });
    const result = await service.agent(ctxWith({ agent: AGENT_KEY, personal: PERSONAL }) as never, {
      operation: "access",
    });
    expect(result.ok).toBe(true);
    expect(store.read()).toMatchObject({ lastAccess: "granted", toolCount: 1 });
    const files = readdirSync(agentDir, { recursive: true }) as string[];
    for (const file of files) {
      const full = path.join(agentDir, file);
      try {
        const body = readFileSync(full, "utf8");
        expect(body).not.toContain(AGENT_KEY);
        expect(body).not.toContain(PERSONAL);
      } catch {
        // directories
      }
    }
    expect(JSON.stringify(result)).not.toContain(AGENT_KEY);
  });
});

describe("Fin Agent API doctor, status, and debug", () => {
  it("gives a cached-only check for each state with the right severity", () => {
    expect(agentKeyCachedCheck({}, "none")).toMatchObject({ severity: "info" });
    expect(agentKeyCachedCheck({}, "pi-auth").title).toContain("not checked yet");
    expect(agentKeyCachedCheck({ lastAccess: "granted", toolCount: 5 }, "pi-auth")).toMatchObject({
      severity: "ok",
    });
    for (const bad of ["wrong_key", "auth_failed", "same_as_personal_token"] as const) {
      expect(agentKeyCachedCheck({ lastAccess: bad }, "pi-auth")).toMatchObject({
        severity: "error",
        fix: "/login sf-fin-agent",
      });
    }
    expect(agentKeyCachedCheck({ lastAccess: "not_granted" }, "env")).toMatchObject({
      severity: "warn",
    });
  });

  it("adds the Agent API check to /sf-pi doctor without network or key reads", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const report = createFinService({
      exec: vi.fn(),
      agentStatusStore: createAgentKeyStatusStore(path.join(agentDir, "s.json")),
    }).cachedDoctorReport();
    expect(report.checks.map((c) => c.id)).toContain("fin.agent-api");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it("lists the Agent API env name and source in the debug bundle, never the value", () => {
    const text = buildDebugBundle({
      snapshot: {},
      debug: {},
      env: { FIN_AGENT_API_KEY: AGENT_KEY, INTERCOM_TOKEN: PERSONAL },
      cliConfigDir: path.join(agentDir, "cli"),
    });
    expect(text).toContain("FIN_AGENT_API_KEY");
    expect(text).toContain("Fin Agent API key source: env");
    expect(text).not.toContain(AGENT_KEY);
    expect(text).not.toContain(PERSONAL);
  });
});
