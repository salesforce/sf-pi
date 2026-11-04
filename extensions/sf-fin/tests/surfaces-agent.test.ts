/* SPDX-License-Identifier: Apache-2.0 */
/** Fin surface comparison and the Fin Agent API harness (no network). */
import { describe, expect, it, vi } from "vitest";
import {
  accessText,
  createAgentApiClient,
  probeAgentApiAccess,
  runScriptedConversation,
  type AgentApiDeps,
} from "../lib/agent-api.ts";
import {
  CAPABILITIES,
  compareSurfaces,
  crawlCliCommands,
  parseSubcommands,
} from "../lib/surfaces.ts";
import { INTERCOM_MCP_TOOLS } from "../../sf-mcp/lib/tool-contracts-intercom.ts";
import { createFinService } from "../lib/service.ts";

const ROOT_HELP = `Usage: intercom [options] [command]

Options:
  --json                         Output as JSON

Commands:
  me [options]                   Show current admin
  fin                            Manage Fin AI Agent
  help [command]                 display help for command

Quick start:
  $ intercom me
`;
const FIN_HELP = `Commands:
  manifest [options]  Show the manifest
  enable [options]    Enable Fin AI Agent on the workspace.
                      
                      This opts the workspace into Fin.
  procedures          Manage procedures
  help [command]      display help for command
`;
const PROC_HELP = `Commands:
  list [options]               List procedures
  get [options] <id> [output]  Download a procedure by ID as YAML (writes to
                               [output], or stdout)
  help [command]               display help for command
`;

describe("surfaces", () => {
  it("parses commander help, skipping wrapped and multi-paragraph descriptions", () => {
    expect(parseSubcommands(ROOT_HELP)).toEqual(["me", "fin"]);
    expect(parseSubcommands(FIN_HELP)).toEqual(["manifest", "enable", "procedures"]);
    expect(parseSubcommands(PROC_HELP)).toEqual(["list", "get"]);
    expect(parseSubcommands("Usage: x\n")).toEqual([]);
  });

  it("crawls the help tree into leaf commands", async () => {
    const pages: Record<string, string> = {
      "": ROOT_HELP,
      me: "Usage: intercom me\n",
      fin: FIN_HELP,
      "fin manifest": "Usage\n",
      "fin enable": "Usage\n",
      "fin procedures": PROC_HELP,
      "fin procedures list": "Usage\n",
      "fin procedures get": "Usage\n",
    };
    const leaves = await crawlCliCommands(async (p) => pages[p.join(" ")]);
    expect(leaves).toEqual([
      "me",
      "fin manifest",
      "fin enable",
      "fin procedures list",
      "fin procedures get",
    ]);
    expect(await crawlCliCommands(async () => undefined)).toBeUndefined();
  });

  it("maps every reviewed Intercom MCP tool to exactly one capability", () => {
    const mapped = CAPABILITIES.flatMap((c) => c.mcp);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual(INTERCOM_MCP_TOOLS.map((t) => t.name).sort());
  });

  it("maps each CLI command at most once and reports drift in both directions", () => {
    const mapped = CAPABILITIES.flatMap((c) => c.cli);
    expect(new Set(mapped).size).toBe(mapped.length);
    const report = compareSurfaces({
      cliCommands: [...mapped.filter((c) => c !== "fin download"), "fin brand-new"],
      cliVersion: "9.9.9",
    });
    expect(report.unmappedCli).toEqual(["fin brand-new"]);
    expect(report.missingCli).toEqual(["fin download"]);
    expect(report.unmappedMcp).toEqual([]);
    const clean = compareSurfaces({ cliCommands: mapped });
    expect(clean.unmappedCli.length + clean.missingCli.length).toBe(0);
  });

  it("service.surfaces fails when the CLI gains an unmapped command, and passes when clean", async () => {
    const leaves = CAPABILITIES.flatMap((c) => c.cli);
    const pagesFor = (extra: string[]) => {
      const all = [...leaves, ...extra];
      return async (p: string[]) => {
        if (p[0] === "--version") return "0.14.1\n";
        const prefix = p.join(" ");
        const children = [
          ...new Set(
            all
              .filter((c) => (prefix ? c.startsWith(`${prefix} `) : true))
              .map((c) => c.split(" ")[p.length]!),
          ),
        ];
        if (children.length === 0) return "Usage\n";
        return `Commands:\n${children.map((n) => `  ${n}  desc`).join("\n")}\n`;
      };
    };
    const clean = await createFinService({ exec: vi.fn(), helpRunner: pagesFor([]) }).surfaces();
    expect(clean.ok).toBe(true);
    expect(clean.details).toMatchObject({ cliVersion: "0.14.1", cliCommands: leaves.length });
    const drift = await createFinService({
      exec: vi.fn(),
      helpRunner: pagesFor(["fin brand-new"]),
    }).surfaces();
    expect(drift.ok).toBe(false);
    expect(drift.text).toContain("New CLI commands: fin brand-new");
  });

  it("gives every capability an SF Fin decision", () => {
    for (const c of CAPABILITIES) {
      expect(c.sfFin.why.length).toBeGreaterThan(10);
      expect(c.cli.length + c.mcp.length + c.agentApi.length).toBeGreaterThan(0);
    }
  });
});

const KEY = "fin-agent-sentinel-1111";
function rpcFetch(handler: (method: string, params: any) => { status?: number; body: unknown }) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const { status = 200, body } = handler(request.method, request.params);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}
const deps = (f: ReturnType<typeof vi.fn>): AgentApiDeps => ({
  fetch: f as unknown as typeof fetch,
  sleep: async () => undefined,
});

describe("Fin Agent API harness", () => {
  it("reports access not granted with request steps, without leaking the key", async () => {
    const f = rpcFetch(() => ({
      status: 403,
      body: {
        type: "error.list",
        errors: [{ code: "api_plan_restricted", message: `Fin Agent API is not enabled ${KEY}` }],
      },
    }));
    const client = createAgentApiClient({ key: KEY, region: "us", deps: deps(f) });
    const access = await probeAgentApiAccess(client);
    expect(access.state).toBe("not_granted");
    const text = accessText(access);
    expect(text).toContain("Settings → Integrations → Fin Agent API");
    expect(text).not.toContain(KEY);
    const init = f.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(f.mock.calls[0]?.[0]).toBe("https://api.intercom.io/fin/mcp");
  });

  it("classifies a rejected key and a granted workspace", async () => {
    const rejected = createAgentApiClient({
      key: KEY,
      region: "eu",
      deps: deps(
        rpcFetch(() => ({ status: 401, body: { errors: [{ message: "Unauthorized" }] } })),
      ),
    });
    expect((await probeAgentApiAccess(rejected)).state).toBe("auth_failed");
    const wrongKey = createAgentApiClient({
      key: KEY,
      region: "us",
      deps: deps(
        rpcFetch(() => ({
          status: 403,
          body: { errors: [{ code: "forbidden", message: "Use the Fin Agent API key" }] },
        })),
      ),
    });
    const wrong = await probeAgentApiAccess(wrongKey);
    expect(wrong.state).toBe("wrong_key");
    expect(accessText(wrong)).toContain("not a Fin Agent API key");
    const granted = createAgentApiClient({
      key: KEY,
      region: "us",
      deps: deps(
        rpcFetch(() => ({
          body: { jsonrpc: "2.0", id: 1, result: { tools: [{ name: "ask_fin" }] } },
        })),
      ),
    });
    expect(await probeAgentApiAccess(granted)).toEqual({ state: "granted", tools: ["ask_fin"] });
  });

  // Shapes observed from the live Fin Agent API MCP server: tool results are
  // plain text; get_fin_response says "has not replied yet" while thinking and
  // returns isError "Conversation not found" just after start.
  const text = (value: string, isError = false) => ({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) },
  });

  it("asks Fin once, polls through not-found and not-yet, and stops after the answer", async () => {
    const calls: string[] = [];
    let polls = 0;
    const f = rpcFetch((_method, params) => {
      calls.push(params?.name);
      if (params?.name === "ask_fin") return { body: text("Message sent to Fin.") };
      polls += 1;
      if (polls === 1)
        return {
          body: text(
            "Conversation not found for id: c. If it was just created, try again in a moment.",
            true,
          ),
        };
      if (polls === 2) return { body: text("Fin has not replied yet.") };
      return { body: text("<p>Go to the sign-in page.</p><p>Select Forgot password.</p>") };
    });
    const client = createAgentApiClient({ key: KEY, region: "us", deps: deps(f) });
    const result = await runScriptedConversation(
      client,
      deps(f),
      { message: "How do I reset my password?", replies: ["ignored for ask"] },
      { conversationId: "c", userId: "u" },
    );
    expect(result).toMatchObject({ ok: true, status: "answered" });
    expect(calls).toEqual(["ask_fin", "get_fin_response", "get_fin_response", "get_fin_response"]);
    expect(result.transcript).toEqual([
      { role: "user", text: "How do I reset my password?" },
      { role: "fin", text: "Go to the sign-in page.\nSelect Forgot password." },
    ]);
    expect(result.text).not.toContain("has not replied yet");
  });

  it("uses a reply returned inline, and sends user_id with each scripted procedure reply", async () => {
    const replyArgs: Array<Record<string, unknown>> = [];
    const f = rpcFetch((_method, params) => {
      if (params?.name === "run_fin_procedure")
        return { body: text("What email do you sign in with?") };
      if (params?.name === "reply_to_fin_conversation") {
        replyArgs.push(params.arguments);
        return { body: text("Thanks. Check your inbox for the reset link.") };
      }
      return { body: text("unexpected poll") };
    });
    const client = createAgentApiClient({ key: KEY, region: "us", deps: deps(f) });
    const result = await runScriptedConversation(
      client,
      deps(f),
      { procedureId: "4242", replies: ["customer@example.com"] },
      { conversationId: "c", userId: "u" },
    );
    expect(result.status).toBe("answered");
    expect(result.transcript.map((t) => t.role)).toEqual(["fin", "user", "fin"]);
    expect(replyArgs).toEqual([
      { conversation_id: "c", message: "customer@example.com", user_id: "u" },
    ]);
  });

  it("ends a stuck conversation after a bounded number of polls", async () => {
    const f = rpcFetch((_m, params) =>
      params?.name === "ask_fin"
        ? { body: text("Message sent to Fin.") }
        : { body: text("Fin has not replied yet.") },
    );
    const client = createAgentApiClient({ key: KEY, region: "us", deps: deps(f) });
    const result = await runScriptedConversation(
      client,
      deps(f),
      { message: "Hello" },
      { conversationId: "c", userId: "u" },
    );
    expect(result).toMatchObject({ ok: false, status: "timed_out" });
    expect(f.mock.calls.length).toBe(1 + 30);
  });

  it("surfaces a real tool error instead of polling forever", async () => {
    const f = rpcFetch((_m, params) =>
      params?.name === "ask_fin"
        ? { body: text("Message sent to Fin.") }
        : { body: text("Rate limit exceeded", true) },
    );
    const client = createAgentApiClient({ key: KEY, region: "us", deps: deps(f) });
    await expect(
      runScriptedConversation(
        client,
        deps(f),
        { message: "Hi" },
        { conversationId: "c", userId: "u" },
      ),
    ).rejects.toThrow(/Rate limit/);
  });
});
