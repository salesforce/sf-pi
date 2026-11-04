/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin Agent API test harness: end-to-end runs against the deployed Fin.
 *
 * The Fin Agent API is granted per workspace on request and uses its own
 * Fin Agent API key (Pi provider `sf-fin-agent`), separate from the personal
 * token the Fin CLI uses. Replies are delivered by webhook, so the harness
 * talks to the Fin Agent API MCP server, whose `get_fin_response` tool polls
 * for them, instead of hosting a webhook receiver.
 *
 * - `access` probes `tools/list`; a 403 `api_plan_restricted` means access has
 *   not been granted and is reported with the steps to request it.
 * - `capabilities` lists audience-matched procedures for a test user (no
 *   conversation, not billable).
 * - `run` drives one scripted conversation: start (procedure run or ask), then
 *   reply with each scripted user message when Fin awaits one, polling with a
 *   bounded attempt count, and reports the transcript and whether Fin answered.
 *   Conversations Fin resolves are billed as outcomes.
 */
import type { FinRegion } from "./types.ts";

export const AGENT_API_PROVIDER = "sf-fin-agent";
export const AGENT_API_ENV_KEY = "FIN_AGENT_API_KEY";
const MAX_POLLS = 30;
const POLL_MS = 3_000;
const MAX_TURNS = 8;
const REQUEST_TIMEOUT_MS = 30_000;

export function agentApiMcpUrl(region: FinRegion): string {
  const host =
    region === "eu"
      ? "api.eu.intercom.io"
      : region === "au"
        ? "api.au.intercom.io"
        : "api.intercom.io";
  return `https://${host}/fin/mcp`;
}

export interface AgentApiDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

export type AgentApiAccess =
  | { state: "granted"; tools: string[] }
  | { state: "not_granted"; message: string }
  | { state: "auth_failed"; message: string }
  | { state: "wrong_key"; message: string }
  | { state: "error"; message: string };

export class AgentApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Minimal JSON-RPC client for the Fin Agent API MCP server (stateless HTTP). */
export function createAgentApiClient(input: {
  key: string;
  region: FinRegion;
  deps: AgentApiDeps;
  signal?: AbortSignal;
}) {
  let nextId = 1;
  const url = agentApiMcpUrl(input.region);
  const rpc = async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout;
    const response = await input.deps.fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.key}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, ...(params ? { params } : {}) }),
      // The key goes only to the fixed regional host; never follow a redirect with it.
      redirect: "error",
      signal,
    });
    const text = redact(await response.text(), input.key);
    if (!response.ok) {
      const parsed = safeJson(text) as
        { errors?: Array<{ code?: string; message?: string }> } | undefined;
      const first = parsed?.errors?.[0];
      throw new AgentApiError(
        first?.message ?? `HTTP ${response.status}`,
        response.status,
        first?.code,
      );
    }
    const body = parseRpcBody(text, response.headers.get("content-type"));
    if (body?.error) throw new AgentApiError(body.error.message ?? "JSON-RPC error");
    return body?.result;
  };
  return {
    listTools: async () => {
      const result = (await rpc("tools/list")) as { tools?: Array<{ name?: string }> } | undefined;
      return (result?.tools ?? []).map((t) => t.name).filter((n): n is string => Boolean(n));
    },
    callTool: async (name: string, args: Record<string, unknown>) => {
      const result = (await rpc("tools/call", { name, arguments: args })) as
        { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | undefined;
      const text = (result?.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("\n");
      if (result?.isError) throw new AgentApiError(text || `${name} failed`);
      return safeJson(text) ?? text;
    },
  };
}

export async function probeAgentApiAccess(
  client: ReturnType<typeof createAgentApiClient>,
): Promise<AgentApiAccess> {
  try {
    return { state: "granted", tools: await client.listTools() };
  } catch (error) {
    if (error instanceof AgentApiError) {
      if (error.status === 403 && error.code === "api_plan_restricted") {
        return { state: "not_granted", message: error.message };
      }
      if (error.status === 403 && error.code === "forbidden") {
        // A non-Agent-API credential (for example a personal token) was sent.
        return { state: "wrong_key", message: error.message };
      }
      if (error.status === 401) return { state: "auth_failed", message: error.message };
    }
    return { state: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

export function accessText(access: AgentApiAccess): string {
  switch (access.state) {
    case "granted":
      return `✅ Fin Agent API access granted (${access.tools.length} tools: ${access.tools.join(", ")}).`;
    case "not_granted":
      return [
        `❌ Fin Agent API access is not granted for this workspace (${access.message}).`,
        "Request it in Fin under Settings → Integrations → Fin Agent API. Once granted, generate the key under Fin AI Agent → Deploy → Fin Agent API and save it with /login sf-fin-agent.",
      ].join("\n");
    case "auth_failed":
      return `❌ The Fin Agent API key was rejected (${access.message}). Generate a new key under Fin AI Agent → Deploy → Fin Agent API and run /login sf-fin-agent.`;
    case "wrong_key":
      return `❌ The saved key is not a Fin Agent API key (${access.message}). The personal API token used for the Fin CLI does not work here; generate the Fin Agent API key under Fin AI Agent → Deploy → Fin Agent API and save it with /login sf-fin-agent.`;
    case "error":
      return `❌ Fin Agent API check failed: ${access.message}`;
  }
}

export interface ScriptedRun {
  /** Run this procedure deterministically; otherwise ask a one-shot question. */
  procedureId?: string;
  /** Opening message (required for ask; optional trigger for a procedure run). */
  message?: string;
  /** User replies sent, in order, each time Fin awaits a reply. */
  replies?: string[];
  /** Test user external id; a unique synthetic id is generated when omitted. */
  userId?: string;
}

export interface RunTranscriptTurn {
  role: "user" | "fin";
  text: string;
}

export interface RunResult {
  ok: boolean;
  conversationId: string;
  status: string;
  transcript: RunTranscriptTurn[];
  text: string;
}

/**
 * Drive one scripted conversation through the Fin Agent API MCP server.
 *
 * The server's tools return plain text, not status objects:
 * - `ask_fin`, `run_fin_procedure`, and `reply_to_fin_conversation` return
 *   Fin's reply when it is ready, or a "sent / started" acknowledgement;
 * - `get_fin_response` returns the reply text, or a "has not replied yet"
 *   notice while Fin is thinking, or an isError "not found" right after start.
 *
 * A turn ends when a reply arrives. `ask_fin` is one-shot by contract (no
 * follow-up), so an ask completes after its first reply. A procedure run
 * continues with the next scripted reply after each Fin turn. Bounded by
 * MAX_TURNS and MAX_POLLS, so a stuck conversation always ends.
 */
export async function runScriptedConversation(
  client: ReturnType<typeof createAgentApiClient>,
  deps: AgentApiDeps,
  run: ScriptedRun,
  ids: { conversationId: string; userId: string },
): Promise<RunResult> {
  const transcript: RunTranscriptTurn[] = [];
  const conversationId = ids.conversationId;
  const userId = run.userId ?? ids.userId;
  if (run.message) transcript.push({ role: "user", text: run.message });
  const started = run.procedureId
    ? await client.callTool("run_fin_procedure", {
        procedure_id: run.procedureId,
        user_id: userId,
        conversation_id: conversationId,
        ...(run.message ? { message: run.message } : {}),
      })
    : await client.callTool("ask_fin", {
        user_id: userId,
        conversation_id: conversationId,
        message: run.message ?? "",
      });

  const replies = [...(run.replies ?? [])];
  let pending: unknown = started;
  let status: RunStatus = "timed_out";
  for (let turn = 0; turn <= MAX_TURNS; turn++) {
    const reply = replyText(pending) ?? (await pollReply(client, deps, conversationId));
    if (reply === undefined) {
      status = "timed_out";
      break;
    }
    transcript.push({ role: "fin", text: reply });
    if (!run.procedureId) {
      // ask_fin is one-shot: one answer, no follow-up.
      status = "answered";
      break;
    }
    const next = replies.shift();
    if (next === undefined) {
      status = "answered";
      break;
    }
    transcript.push({ role: "user", text: next });
    pending = await client.callTool("reply_to_fin_conversation", {
      conversation_id: conversationId,
      message: next,
      user_id: userId,
    });
  }
  return {
    ok: status === "answered",
    conversationId,
    status,
    transcript,
    text: formatRun(conversationId, status, transcript),
  };
}

export type RunStatus = "answered" | "timed_out";

/** Fin's reply text from a tool result, or undefined for an acknowledgement or "not yet". */
export function replyText(result: unknown): string | undefined {
  if (result === undefined || result === null) return undefined;
  if (typeof result === "object") {
    const record = result as Record<string, unknown>;
    const body =
      typeof record.message === "string"
        ? record.message
        : typeof (record.message as Record<string, unknown> | undefined)?.body === "string"
          ? ((record.message as Record<string, unknown>).body as string)
          : typeof record.reply === "string"
            ? record.reply
            : undefined;
    return body ? replyText(body) : undefined;
  }
  const text = stripHtml(String(result));
  if (!text || isNotYet(text)) return undefined;
  return text;
}

function isNotYet(text: string): boolean {
  return /^(fin has not replied yet|fin is (still )?thinking|message sent|procedure started|conversation not found)/i.test(
    text.trim(),
  );
}

async function pollReply(
  client: ReturnType<typeof createAgentApiClient>,
  deps: AgentApiDeps,
  conversationId: string,
): Promise<string | undefined> {
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    try {
      const reply = replyText(
        await client.callTool("get_fin_response", { conversation_id: conversationId }),
      );
      if (reply !== undefined) return reply;
    } catch (error) {
      // Right after start the conversation may not be visible yet; keep polling.
      if (!(error instanceof AgentApiError) || !/not found/i.test(error.message)) throw error;
    }
    await deps.sleep(POLL_MS);
  }
  return undefined;
}

function formatRun(
  conversationId: string,
  status: RunStatus,
  transcript: RunTranscriptTurn[],
): string {
  return [
    `${status === "answered" ? "✅" : "⚠"} Fin Agent API run ${conversationId} — ${status === "answered" ? "Fin answered" : "no reply within the poll limit"}`,
    ...transcript.map((t) => `${t.role === "user" ? "User" : "Fin"}: ${t.text.slice(0, 600)}`),
  ].join("\n");
}

function stripHtml(text: string): string {
  return text
    .replace(/<\/(p|li|div|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function parseRpcBody(
  text: string,
  contentType: string | null,
): { result?: unknown; error?: { message?: string } } | undefined {
  if (contentType?.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .pop();
    return data ? (safeJson(data) as never) : undefined;
  }
  return safeJson(text) as never;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function redact(text: string, secret: string): string {
  return secret.length >= 4 ? text.split(secret).join("[redacted]") : text;
}
