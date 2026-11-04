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
const toolResult = (value: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  result: { content: [{ type: "text", text: JSON.stringify(value) }] },
});
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

  it("drives a scripted procedure run through awaiting replies to completion", async () => {
    // Fin asks for an email, waits; after the reply it answers and completes.
    let replied = false;
    const calls: string[] = [];
    const f = rpcFetch((method, params) => {
      calls.push(params?.name ?? method);
      if (params?.name === "reply_to_fin_conversation") replied = true;
      if (params?.name === "get_fin_response") {
        return {
          body: toolResult(
            replied
              ? { status: "complete", messages: [{ body: "Done." }] }
              : {
                  status: "awaiting_user_reply",
                  messages: [{ body: "<p>What is your email?</p>" }],
                },
          ),
        };
      }
      return { body: toolResult({ status: "thinking" }) };
    });
    const client = createAgentApiClient({ key: KEY, region: "us", deps: deps(f) });
    const result = await runScriptedConversation(
      client,
      deps(f),
      { procedureId: "4242", replies: ["customer@example.com"] },
      { conversationId: "sf-pi-x", userId: "sf-pi-test-x" },
    );
    expect(calls[0]).toBe("run_fin_procedure");
    expect(calls).toContain("reply_to_fin_conversation");
    expect(result.status).toBe("complete");
    expect(result.ok).toBe(true);
    expect(result.transcript.map((t) => t.role)).toEqual(["fin", "user", "fin"]);
    expect(result.transcript[0]?.text).toBe("What is your email?");
  });

  it("ends a stuck conversation after a bounded number of polls", async () => {
    const f = rpcFetch((_m, params) =>
      params?.name === "get_fin_response"
        ? { body: toolResult({ status: "thinking" }) }
        : { body: toolResult({ status: "thinking" }) },
    );
    const client = createAgentApiClient({ key: KEY, region: "us", deps: deps(f) });
    const result = await runScriptedConversation(
      client,
      deps(f),
      { message: "Hello" },
      { conversationId: "c", userId: "u" },
    );
    expect(result.status).toBe("timed_out");
    expect(result.ok).toBe(false);
    expect(f.mock.calls.length).toBeLessThanOrEqual(1 + 30);
  });
});
