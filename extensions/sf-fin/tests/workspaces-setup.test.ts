/* SPDX-License-Identifier: Apache-2.0 */
/** Named workspaces, automatic region discovery, and the unified setup check. */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverRegion } from "../lib/region.ts";
import { createAgentKeyStatusStore } from "../lib/agent-key.ts";
import { evaluateSetup, workspaceIdFromMcpText, type SetupFacts } from "../lib/setup.ts";
import { createFinService } from "../lib/service.ts";
import {
  addWorkspace,
  bindWorkspaceIdentity,
  createWorkspaceStore,
  readWorkspaces,
  removeWorkspace,
  resolveWorkspace,
  useWorkspace,
  workspaceNameIssue,
  workspaceProviders,
} from "../lib/workspaces.ts";

const TOKEN = "fin-personal-sentinel-token-11111111";
const AGENT = "fin-agent-sentinel-key-000000000000";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-fin-ws-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", dir);
  vi.stubEnv("INTERCOM_TOKEN", "");
  vi.stubEnv("FIN_AGENT_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});
const store = () => createWorkspaceStore(path.join(dir, "workspaces.json"));

describe("workspace profiles", () => {
  it("always has a default test workspace using the original sign-in names", () => {
    const state = readWorkspaces(store());
    expect(state.active).toBe("default");
    expect(state.workspaces.default).toMatchObject({ kind: "test" });
    expect(workspaceProviders("default")).toEqual({
      personal: "sf-fin",
      agent: "sf-fin-agent",
      browser: "sf-fin-browser",
      mcpConnection: "intercom",
    });
    expect(workspaceProviders("prod")).toEqual({
      personal: "sf-fin-prod",
      agent: "sf-fin-agent-prod",
      browser: "sf-fin-browser-prod",
      mcpConnection: "intercom-prod",
    });
  });

  it("adds, uses, and removes named workspaces; validates names", () => {
    const s = store();
    expect(addWorkspace(s, "prod", "prod")).toMatchObject({ ok: true });
    expect(addWorkspace(s, "prod", "prod")).toMatchObject({ ok: false });
    for (const bad of [
      "Prod",
      "1x",
      "default",
      "agent",
      "agent-x",
      "browser",
      "browser-x",
      "a b",
      "x".repeat(25),
    ]) {
      expect(workspaceNameIssue(bad)).toBeDefined();
    }
    expect(useWorkspace(s, "prod")).toMatchObject({ ok: true });
    expect(resolveWorkspace(s)).toMatchObject({
      ok: true,
      profile: { name: "prod", kind: "prod" },
    });
    expect(resolveWorkspace(s, "nope")).toMatchObject({ ok: false });
    expect(removeWorkspace(s, "default")).toMatchObject({ ok: false });
    expect(removeWorkspace(s, "prod")).toMatchObject({ ok: true });
    expect(readWorkspaces(s).active).toBe("default");
  });

  it("binds the verified app id once and refuses a credential for another app", () => {
    const s = store();
    const at = "2026-01-01T00:00:00.000Z";
    expect(bindWorkspaceIdentity(s, "default", { appId: "app1", region: "us", at })).toMatchObject({
      ok: true,
      profile: { appId: "app1", region: "us" },
    });
    const other = bindWorkspaceIdentity(s, "default", { appId: "app2", region: "eu", at });
    expect(other).toMatchObject({ ok: false });
    expect(readWorkspaces(s).workspaces.default?.appId).toBe("app1");
  });

  it("stores no credential material in the profiles file", () => {
    const s = store();
    addWorkspace(s, "prod", "prod");
    bindWorkspaceIdentity(s, "prod", { appId: "app9", region: "au", at: "t" });
    const body = readFileSync(s.path, "utf8");
    expect(body).not.toContain(TOKEN);
    expect(body).not.toMatch(/key|token|secret/i);
  });
});

describe("region discovery", () => {
  function meFetch(home: string | undefined) {
    return vi.fn(async (url: string, init: RequestInit) => {
      expect(init.redirect).toBe("error");
      expect(String(url)).toMatch(/^https:\/\/api\.(eu\.|au\.)?intercom\.io\/me$/);
      return url.includes(home ?? "nowhere")
        ? new Response(
            JSON.stringify({
              name: "Admin",
              app: { id_code: "app1", name: "Example", region: "EU" },
            }),
            { status: 200 },
          )
        : new Response("{}", { status: 401 });
    });
  }

  it("tries the preferred region first and stops at the first 200", async () => {
    const f = meFetch("api.eu.");
    const found = await discoverRegion(TOKEN, { fetch: f as never, prefer: "eu" });
    expect(found).toMatchObject({ ok: true, identity: { region: "eu", appId: "app1" } });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reports rejected-everywhere distinctly from network failure", async () => {
    expect(await discoverRegion(TOKEN, { fetch: meFetch(undefined) as never })).toMatchObject({
      ok: false,
      reason: "rejected_everywhere",
    });
    const down = vi.fn(async () => {
      throw new Error("ENOTFOUND");
    });
    expect(await discoverRegion(TOKEN, { fetch: down as never })).toMatchObject({
      ok: false,
      reason: "network",
    });
  });
});

describe("setup evaluation", () => {
  const base: SetupFacts = {
    workspace: { name: "default", kind: "test" },
    cliInstalled: true,
    personal: { state: "missing" },
    agent: { state: "missing" },
    mcp: { state: "not_configured" },
  };

  it("lists only the steps for the capabilities asked for", () => {
    const testOnly = evaluateSetup(base, ["test"]);
    expect(testOnly.steps.map((s) => s.capability)).toEqual(["test"]);
    expect(testOnly.steps[0]?.command).toBe("/login sf-fin-agent");
    const all = evaluateSetup(base, ["build", "operator", "test"]);
    expect(all.steps.map((s) => s.command)).toEqual([
      "/login sf-fin",
      "/mcp login intercom",
      "/login sf-fin-agent",
    ]);
  });

  it("is ready when each credential checks out, and flags cross-credential app mismatches", () => {
    const ready = evaluateSetup(
      {
        ...base,
        personal: { state: "ok", identity: { region: "us", appId: "app1" } },
        agent: { state: "checked", access: { state: "granted", tools: ["ask_fin"] } },
        mcp: { state: "signed_in", appId: "app1" },
      },
      ["build", "operator", "test"],
    );
    expect(ready.ready).toEqual({ build: true, operator: true, test: true });
    expect(ready.steps).toEqual([]);
    expect(ready.lines.join("\n")).toContain(
      "not provable (the Agent API exposes no workspace id)",
    );

    const mismatch = evaluateSetup(
      {
        ...base,
        personal: { state: "ok", identity: { region: "us", appId: "app1" } },
        mcp: { state: "signed_in", appId: "app2" },
      },
      ["build", "operator"],
    );
    expect(mismatch.mismatches[0]).toContain("app2");
    expect(mismatch.ready).toMatchObject({ build: false, operator: false });
  });

  it("names the access-request step when Fin Agent API access is not granted", () => {
    const report = evaluateSetup(
      { ...base, agent: { state: "checked", access: { state: "not_granted", message: "x" } } },
      ["test"],
    );
    expect(report.steps[0]).toMatchObject({ capability: "test" });
    expect(report.steps[0]?.command).toBeUndefined();
    expect(report.steps[0]?.text).toContain("Settings → Integrations → Fin Agent API");
  });

  it("reads workspace_id from untrusted MCP article text", () => {
    expect(workspaceIdFromMcpText('{"articles":[{"workspace_id":"abc123"}]}')).toBe("abc123");
    expect(workspaceIdFromMcpText("no articles")).toBeUndefined();
  });
});

describe("service.setup", () => {
  function ctxWith(keys: { personal?: string; agent?: string }, mcpText?: string) {
    return {
      cwd: dir,
      signal: undefined,
      modelRegistry: {
        getProviderAuth: vi.fn(async (provider: string) => {
          const key = provider.startsWith("sf-fin-agent") ? keys.agent : keys.personal;
          return key ? { auth: { apiKey: key }, env: { INTERCOM_REGION: "us" } } : undefined;
        }),
      },
      executeTool: vi.fn(async () =>
        mcpText === undefined
          ? { isError: true, result: { content: [{ type: "text", text: "Tool not found" }] } }
          : { isError: false, result: { content: [{ type: "text", text: mcpText }] } },
      ),
    };
  }
  const fetchFor = () =>
    vi.fn(async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (String(url).endsWith("/me")) {
        return auth === `Bearer ${TOKEN}` && String(url).startsWith("https://api.intercom.io")
          ? new Response(
              JSON.stringify({ app: { id_code: "app1", name: "Example", region: "US" } }),
              {
                status: 200,
              },
            )
          : new Response("{}", { status: 401 });
      }
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "ask_fin" }] } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

  it("proves the workspace, binds it, and reports all three credentials without leaking them", async () => {
    const f = fetchFor();
    const s = store();
    const service = createFinService({
      exec: vi.fn(async () => ({
        code: 0,
        stdout: "/usr/local/bin/intercom\n0.14.1\n",
        stderr: "",
      })) as never,
      fetch: f as never,
      workspaceStore: s,
      agentDeps: { fetch: f as never, sleep: async () => {} },
      agentStatusStore: createAgentKeyStatusStore(path.join(dir, "agent.json")),
    });
    const result = await service.setup(
      ctxWith({ personal: TOKEN, agent: AGENT }, '{"workspace_id":"app1"}') as never,
      { wants: ["operator", "test"] },
    );
    expect(result.details).toMatchObject({
      appId: "app1",
      ready: { operator: true, test: true },
      mismatches: [],
    });
    expect(readWorkspaces(s).workspaces.default).toMatchObject({ appId: "app1", region: "us" });
    expect(result.text).not.toContain(TOKEN);
    expect(result.text).not.toContain(AGENT);
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".json")) {
        const body = readFileSync(path.join(dir, file), "utf8");
        expect(body).not.toContain(TOKEN);
        expect(body).not.toContain(AGENT);
      }
    }
  });

  it("refuses to bind a workspace to a second app and reports the mismatch", async () => {
    const s = store();
    bindWorkspaceIdentity(s, "default", { appId: "appOther", region: "us", at: "t" });
    const service = createFinService({
      exec: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) as never,
      fetch: fetchFor() as never,
      workspaceStore: s,
    });
    const result = await service.setup(ctxWith({ personal: TOKEN }) as never, { wants: ["build"] });
    expect(result.ok).toBe(false);
    expect(String((result.details.mismatches as string[])[0])).toContain("appOther");
  });

  it("uses per-workspace sign-ins for a named workspace", async () => {
    const s = store();
    addWorkspace(s, "staging", "test");
    const service = createFinService({
      exec: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) as never,
      fetch: fetchFor() as never,
      workspaceStore: s,
    });
    const ctx = ctxWith({});
    const result = await service.setup(ctx as never, { workspace: "staging", wants: ["build"] });
    expect(ctx.modelRegistry.getProviderAuth).toHaveBeenCalledWith("sf-fin-staging");
    expect(ctx.modelRegistry.getProviderAuth).toHaveBeenCalledWith("sf-fin-agent-staging");
    expect(result.text).toContain("/login sf-fin-staging");
  });

  it("routes credentialed actions to the requested workspace's sign-ins", async () => {
    const s = store();
    addWorkspace(s, "staging", "test");
    const service = createFinService({
      exec: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })) as never,
      workspaceStore: s,
    });
    const ctx = ctxWith({});
    const upload = await service.procedure(
      ctx as never,
      { operation: "publish", procedureId: "1" },
      "staging",
    );
    expect(upload.ok).toBe(false);
    expect(upload.text).toContain("/login sf-fin-staging");
    expect(ctx.modelRegistry.getProviderAuth).toHaveBeenCalledWith("sf-fin-staging");
    expect(ctx.modelRegistry.getProviderAuth).not.toHaveBeenCalledWith("sf-fin");
    const agent = await service.agent(ctx as never, { operation: "access" }, "staging");
    expect(agent.text).toContain("/login sf-fin-agent-staging");
    const unknown = await service.sdk(ctx as never, "manifest", "nope");
    expect(unknown).toMatchObject({ ok: false, details: { phase: "workspace" } });
  });
});
