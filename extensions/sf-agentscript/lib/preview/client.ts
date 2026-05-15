/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Minimal preview client — talks to SFAP /einstein/ai-agent/v1.1/preview
 * endpoints via @salesforce/core Connection. Mirrors the upstream
 * `ScriptAgent` lifecycle (start / send / end / trace) without importing
 * @salesforce/agents.
 *
 * Local-first: when `agentSource` is provided, we compile via the local
 * vendored SDK first (rejects bad input before we burn a network call) and
 * only fall back to the server compile endpoint when local fails.
 *
 * Endpoints used:
 *   POST /einstein/ai-agent/v1.1/authoring/scripts          server compile (.agent → AgentJSON)
 *   POST /einstein/ai-agent/v1.1/preview/sessions           start session
 *   POST /einstein/ai-agent/v1.1/preview/sessions/{sid}/messages   send message
 *   GET  /einstein/ai-agent/v1.1/preview/sessions/{sid}/plans/{pid}  fetch trace
 */

import { randomUUID } from "node:crypto";
import type { Connection } from "@salesforce/core";
import { sfap404Message } from "../errors/sfap-404.ts";
import { isSfapRoutingFailure, sfapRequest } from "../eval/sfap.ts";
import { fetchTrace } from "../eval/trace-client.ts";
import { summarizeProductionResponse, summarizeTrace, type TraceDigest } from "./trace-digest.ts";
import {
  endSession as endSessionStore,
  getSessionDir,
  initSession,
  loadSession,
  logTrace,
  logTurn,
  type PreviewMetadata,
} from "./session-store.ts";
import { loadAgentforceSDK } from "../sdk.ts";
import { resolveAgentVersionDeveloperName } from "./resolve-agent-version.ts";
import { mapPreviewError } from "./error-map.ts";

// -------------------------------------------------------------------------------------------------
// SFAP endpoint pins
// -------------------------------------------------------------------------------------------------

const COMPILE_URL = "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts";
const SESSIONS_URL = "https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions";
const MESSAGES_URL = (sid: string): string =>
  `https://api.salesforce.com/einstein/ai-agent/v1.1/preview/sessions/${sid}/messages`;

// Production-agent (already published) lives on /v1/agents/<botId>/sessions —
// no agentDefinition payload, just a session start. Used by
// startPreviewByApiName when the LLM wants to converse with a live agent.
const PROD_AGENT_SESSION_URL = (botId: string): string =>
  `https://api.salesforce.com/einstein/ai-agent/v1/agents/${botId}/sessions`;
const PROD_SESSION_URL = (sid: string): string =>
  `https://api.salesforce.com/einstein/ai-agent/v1/sessions/${sid}`;
const PROD_MESSAGES_URL = (sid: string): string => `${PROD_SESSION_URL(sid)}/messages`;

interface CompileResponseBody {
  status?: string;
  compiledArtifact?: AgentJson;
}

interface AgentJson {
  globalConfiguration?: {
    label?: string;
    agentType?: string;
    defaultAgentUser?: string;
  };
  agentVersion?: { developerName?: string };
}

interface SessionStartBody {
  sessionId: string;
  messages?: Array<{ message?: string }>;
}

interface SessionMessageBody {
  messages?: Array<{ message?: string; planId?: string }>;
}

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export interface PreviewStartOptions {
  conn: Connection;
  cwd: string;
  agentName: string;
  /** Inline `.agent` source (preferred). Required for now. */
  agentSource: string;
  mockMode: "Mock" | "Live Test";
  /**
   * Absolute path to the `.agent` file. When provided we look up the
   * sibling `<bundle>.bundle-meta.xml` to mirror the upstream CLI's
   * `<target>X.vN</target>` resolution for `agentVersion.developerName`.
   * Optional — `agentSource` alone still works.
   */
  agentFilePath?: string;
  /**
   * Pin `agentDefinition.agentVersion.developerName` explicitly. Highest
   * priority resolver source. Use when previewing a specific BotVersion
   * (e.g. `"v3"`). When omitted we resolve from bundle-meta → SOQL → `"v0"`.
   */
  versionDeveloperName?: string;
  /**
   * Target-org alias / username the session is being started against.
   * Persisted in metadata.json so subsequent send/end/trace calls don't
   * have to repeat `target_org` (omitting it would otherwise silently
   * fall back to the global default org and 500 with "Session not found").
   */
  targetOrg?: string;
}

export interface PreviewStartResult {
  sessionId: string;
  agentResponse: string;
  startedAt: string;
  sessionDir: string;
  /**
   * Surface digest for the initial agent message. Only populated for
   * production-agent (`api_name`) sessions — local `.agent` preview start
   * doesn't run the planner yet, so its first digest comes from the first
   * `sendMessage`.
   */
  digest?: TraceDigest;
}

export interface PreviewSendOptions {
  conn: Connection;
  cwd: string;
  agentName: string;
  sessionId: string;
  message: string;
  /** When true, fetch + return Apex debug log captured during this turn. */
  apexDebug?: boolean;
  /**
   * Per-turn deterministic state seeds. Same shape as the eval API's
   * `context_variables` on `agent.send_message` steps so users can
   * copy-paste between eval specs and live preview.
   *
   * Translated to the SFAP wire field `variables` on the way out.
   * Per-message seeding (rather than session-level) is the live
   * workaround for the 2026-04 platform regression that drops
   * session-level state seeds. The eval-API path preserves the same
   * field via `lib/eval/normalize.ts` (no `stripUnrecognizedFields`).
   */
  contextVariables?: ContextVariable[];
}

/**
 * Deterministic state seed sent with a single user turn. The SFAP
 * /messages endpoint accepts `value` as a string (other shapes are
 * coerced server-side); we keep the type permissive so callers can
 * also pass numbers or booleans without manual stringification.
 */
export interface ContextVariable {
  name: string;
  /** SFAP variable type. Default 'Text'. */
  type?: string;
  value: string | number | boolean;
}

export interface PreviewSendResult {
  agentResponse: string;
  topic?: string;
  invokedActions?: string[];
  latencyMs?: number;
  planId: string;
  traceFile?: string;
  apexDebugLog?: string;
  /**
   * Compact, LLM-friendly digest of the planner trace. One row per planner
   * step (every step type is preserved verbatim). Heavy fields are clipped;
   * the full trace JSON lives at `traceFile` for deep dives.
   *
   * Empty timeline + `notes` are populated when the digest could not be
   * built (e.g. eval-spawned session whose plan is not addressable through
   * the preview-trace API).
   */
  digest?: TraceDigest;
}

export interface PreviewStartByApiNameOptions {
  conn: Connection;
  cwd: string;
  agentApiName: string;
  /** See `PreviewStartOptions.targetOrg`. */
  targetOrg?: string;
}

export interface PreviewEndOptions {
  conn?: Connection;
  cwd: string;
  agentName: string;
  sessionId: string;
}

export interface PreviewEndResult {
  endedAt: string;
  metadata: PreviewMetadata;
  summary: { turns: number; plans: number };
  remoteEnded?: boolean;
  remoteEndError?: string;
}

// -------------------------------------------------------------------------------------------------
// startPreview — server compile + session create + first turn logged
// -------------------------------------------------------------------------------------------------

export async function startPreview(opts: PreviewStartOptions): Promise<PreviewStartResult> {
  // 1. Local-first validation
  const sdk = await loadAgentforceSDK();
  if (sdk) {
    const compileResult = (
      sdk as unknown as {
        compileSource: (s: string) => { diagnostics: { severity: number }[] };
      }
    ).compileSource(opts.agentSource);
    const sev1 = compileResult.diagnostics.filter((d) => d.severity === 1);
    if (sev1.length > 0) {
      throw new Error(
        `Local compile rejected the agent source (${sev1.length} severity-1 errors). ` +
          `Fix locally first via agentscript_compile / agentscript_mutate before starting preview.`,
      );
    }
  }

  // 2. Server compile to obtain AgentJSON for the session start payload.
  const compileResp = await sfapRequest<CompileResponseBody>(opts.conn, {
    url: COMPILE_URL,
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: {
      assets: [{ type: "AFScript", name: "AFScript", content: opts.agentSource }],
      afScriptVersion: "2.0.0",
    },
  });
  if (
    compileResp.status < 200 ||
    compileResp.status >= 300 ||
    compileResp.body.status !== "success"
  ) {
    if (isSfapRoutingFailure(compileResp)) {
      throw new Error(sfap404Message({ phase: "compile" }));
    }
    throw new Error(
      `Server compile failed (HTTP ${compileResp.status}): ${JSON.stringify(compileResp.body).slice(0, 600)}`,
    );
  }
  const agentJson = compileResp.body.compiledArtifact;
  if (!agentJson) {
    throw new Error("Server compile returned no compiledArtifact.");
  }

  // 3. Pin agentVersion.developerName so the planner cache lookup succeeds.
  // Server returns 500 "bot version ID to insert into cache, but record not
  // found" when this is null/missing or names a non-existent BotVersion.
  // Resolution priority: caller override → bundle-meta `<target>vN</target>`
  // → latest BotVersion via SOQL → `"v0"` (server fresh-preview sentinel).
  const versionResolution = await resolveAgentVersionDeveloperName({
    override: opts.versionDeveloperName,
    agentFilePath: opts.agentFilePath,
    conn: opts.conn,
    agentName: opts.agentName,
  });
  agentJson.agentVersion = {
    ...((agentJson.agentVersion as Record<string, unknown> | undefined) ?? {}),
    developerName: versionResolution.developerName,
  } as AgentJson["agentVersion"];

  // 4. bypassUser rule (verbatim from upstream ScriptAgent).
  let bypassUser = false;
  const defaultAgentUser = agentJson.globalConfiguration?.defaultAgentUser;
  if (defaultAgentUser) {
    const r = await opts.conn.query<{ Id: string }>(
      `SELECT Id FROM User WHERE Username='${soqlEscape(defaultAgentUser)}'`,
    );
    bypassUser = r.totalSize === 1;
  }
  if (bypassUser && agentJson.globalConfiguration?.agentType === "AgentforceEmployeeAgent") {
    bypassUser = false;
  }

  // 5. Start session.
  const sessionResp = await sfapRequest<SessionStartBody>(opts.conn, {
    url: SESSIONS_URL,
    method: "POST",
    headers: {
      "x-attributed-client": "no-builder",
      "x-client-name": "sf-pi",
      "content-type": "application/json",
    },
    body: {
      agentDefinition: agentJson,
      enableSimulationMode: opts.mockMode === "Mock",
      externalSessionKey: randomUUID(),
      instanceConfig: { endpoint: opts.conn.instanceUrl },
      variables: [],
      parameters: {},
      streamingCapabilities: { chunkTypes: ["Text", "LightningChunk"] },
      richContentCapabilities: {},
      bypassUser,
      executionHistory: [],
      conversationContext: [],
    },
  });
  if (sessionResp.status < 200 || sessionResp.status >= 300) {
    const mapped = mapPreviewError(sessionResp.status, sessionResp.body, {
      phase: "start",
      surface: "agent_file",
      agentName: opts.agentName,
    });
    throw new Error(mapped.message);
  }

  const startTime = new Date().toISOString();
  const sessionId = sessionResp.body.sessionId;
  if (!sessionId) {
    throw new Error("Session start returned no sessionId.");
  }

  // 6. Init session store + write the first agent turn. Persist the SFAP
  // host that served `start` so subsequent send/end/trace calls pin to the
  // same shard (sessions don't replicate across api / test.api / dev.api).
  // Also persist target-org and agent-file path so end can suggest the
  // exact next `lifecycle publish` command without the caller refeeding
  // them.
  const sessionDir = await initSession(opts.cwd, {
    sessionId,
    agentName: opts.agentName,
    startTime,
    mockMode: opts.mockMode,
    sessionKind: "agent_file",
    endpoint: sessionResp.endpoint,
    targetOrg: opts.targetOrg,
    agentFilePath: opts.agentFilePath,
  });
  const initialMsg = (sessionResp.body.messages ?? []).map((m) => m.message ?? "").join("\n");
  await logTurn(sessionDir, {
    timestamp: startTime,
    agentName: opts.agentName,
    sessionId,
    role: "agent",
    text: initialMsg,
    raw: sessionResp.body.messages,
  });

  return { sessionId, agentResponse: initialMsg, startedAt: startTime, sessionDir };
}

// -------------------------------------------------------------------------------------------------
// sendMessage — POST a user utterance, log both turns, fetch the trace
// -------------------------------------------------------------------------------------------------

export async function sendMessage(opts: PreviewSendOptions): Promise<PreviewSendResult> {
  const sessionDir = getSessionDir(opts.cwd, opts.agentName, opts.sessionId);
  const { metadata } = await loadSession(opts.cwd, opts.agentName, opts.sessionId);
  const messageUrl =
    metadata.sessionKind === "api_name"
      ? PROD_MESSAGES_URL(opts.sessionId)
      : MESSAGES_URL(opts.sessionId);

  // Log the user turn first so transcripts are append-only and crash-safe.
  await logTurn(sessionDir, {
    timestamp: new Date().toISOString(),
    agentName: opts.agentName,
    sessionId: opts.sessionId,
    role: "user",
    text: opts.message,
  });

  const start = Date.now();
  const resp = await sfapRequest<SessionMessageBody>(opts.conn, {
    url: messageUrl,
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: {
      message: { sequenceId: Date.now(), type: "Text", text: opts.message },
      variables: normalizeContextVariables(opts.contextVariables),
      ...(opts.apexDebug ? { apexDebugging: true } : {}),
    },
    // Pin to the SFAP host that served `start` (sessions are shard-local).
    // Falls back to the full host walk for legacy sessions written before
    // we persisted `endpoint` in metadata.
    ...(metadata.endpoint !== undefined ? { pinnedEndpoint: metadata.endpoint } : {}),
  });
  if (resp.status < 200 || resp.status >= 300) {
    const mapped = mapPreviewError(resp.status, resp.body, {
      phase: "send",
      surface: metadata.sessionKind === "api_name" ? "api_name" : "agent_file",
      agentName: opts.agentName,
    });
    throw new Error(mapped.message);
  }
  const latencyMs = Date.now() - start;
  const first = (resp.body.messages ?? [])[0];
  const planId = first?.planId ?? "";
  const agentResponse = first?.message ?? "";

  // Log the agent turn.
  await logTurn(sessionDir, {
    timestamp: new Date().toISOString(),
    agentName: opts.agentName,
    sessionId: opts.sessionId,
    role: "agent",
    text: agentResponse,
    raw: resp.body.messages,
    planId,
  });

  // Fetch + persist the trace if available; otherwise (production-v1) build
  // a surface digest directly from the send response.
  let traceFile: string | undefined;
  let topic: string | undefined;
  let invokedActions: string[] | undefined;
  let digest: TraceDigest | undefined;
  if (planId && metadata.sessionKind !== "api_name") {
    try {
      const trace = await fetchTrace(opts.conn, opts.sessionId, planId, {
        timeoutMs: 60_000,
        pinnedEndpoint: metadata.endpoint,
      });
      if (trace) {
        await logTrace(sessionDir, planId, trace);
        const tracePath = `${sessionDir}/traces/${planId}.json`;
        traceFile = tracePath;
        digest = summarizeTrace(trace, {
          planId,
          traceFile: tracePath,
          userInput: opts.message,
          agentResponse,
          latencyMs,
        });
        topic = digest.turn.topic;
        invokedActions = digest.timeline
          .filter((r) => r.t === "FunctionStep" || r.t === "FunctionCallStep")
          .map((r) => (r.fn as string | undefined) ?? undefined)
          .filter((s): s is string => typeof s === "string");
        if (invokedActions.length === 0) invokedActions = undefined;
      }
    } catch {
      /* trace fetch is non-fatal */
    }
  } else if (metadata.sessionKind === "api_name") {
    // Production-agent v1 has no trace endpoint; build a surface digest
    // from the response itself so the LLM still sees response type, safety
    // flag, action results, and citations.
    digest = summarizeProductionResponse(
      resp.body.messages as Parameters<typeof summarizeProductionResponse>[0],
      { userInput: opts.message, latencyMs, planId: planId || undefined },
    );
    invokedActions = digest.timeline
      .filter((r) => r.t === "FunctionStep")
      .map((r) => (r.fn as string | undefined) ?? undefined)
      .filter((s): s is string => typeof s === "string");
    if (invokedActions.length === 0) invokedActions = undefined;
  }

  // When apex_debug is requested, fetch the latest debug log captured during
  // this turn. Best-effort — we use the user's UserId from conn.identity().
  let apexDebugLog: string | undefined;
  if (opts.apexDebug) {
    try {
      apexDebugLog = await fetchLatestApexDebugLog(opts.conn, start);
    } catch {
      /* non-fatal */
    }
  }

  return {
    agentResponse,
    topic,
    invokedActions,
    latencyMs,
    planId,
    traceFile,
    apexDebugLog,
    digest,
  };
}

/**
 * Fetch the most recent ApexLog row created since `sinceMs`. Best-effort.
 * Returns `undefined` if no debug log was produced (apex_debug requires
 * Apex execution during the turn AND the user's debug levels to be
 * enabled).
 */
async function fetchLatestApexDebugLog(
  conn: Connection,
  sinceMs: number,
): Promise<string | undefined> {
  const sinceIso = new Date(sinceMs).toISOString();
  const r = await conn.query<{ Id: string }>(
    `SELECT Id FROM ApexLog ` +
      `WHERE LastModifiedDate >= ${sinceIso} ` +
      `ORDER BY LastModifiedDate DESC LIMIT 1`,
  );
  const logId = r.records[0]?.Id;
  if (!logId) return undefined;
  const body = (await conn.request({
    method: "GET",
    url: `/services/data/v${conn.getApiVersion()}/sobjects/ApexLog/${logId}/Body`,
  } as Parameters<typeof conn.request>[0])) as string;
  return typeof body === "string" ? body : undefined;
}

// -------------------------------------------------------------------------------------------------
// endSession — finalize metadata
// -------------------------------------------------------------------------------------------------

export async function endPreview(opts: PreviewEndOptions): Promise<PreviewEndResult> {
  const sessionDir = getSessionDir(opts.cwd, opts.agentName, opts.sessionId);
  const { metadata: beforeEnd, transcript } = await loadSession(
    opts.cwd,
    opts.agentName,
    opts.sessionId,
  );

  let remoteEnded: boolean | undefined;
  let remoteEndError: string | undefined;
  if (opts.conn && beforeEnd.sessionKind === "api_name") {
    const endResp = await sfapRequest<unknown>(opts.conn, {
      url: PROD_SESSION_URL(opts.sessionId),
      method: "DELETE",
      headers: { "x-session-end-reason": "UserRequest" },
      timeoutMs: 30_000,
      // Pin to the host that served `start`.
      ...(beforeEnd.endpoint !== undefined ? { pinnedEndpoint: beforeEnd.endpoint } : {}),
    });
    remoteEnded = endResp.status >= 200 && endResp.status < 300;
    if (!remoteEnded) {
      remoteEndError = `Remote session end failed (HTTP ${endResp.status}): ${JSON.stringify(endResp.body).slice(0, 300)}`;
    }
  }

  const endedAt = new Date().toISOString();
  const metadata = await endSessionStore(sessionDir, endedAt);
  return {
    endedAt,
    metadata,
    summary: {
      turns: transcript.filter((t) => t.role === "user").length,
      plans: metadata.planIds.length,
    },
    remoteEnded,
    remoteEndError,
  };
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function soqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

/**
 * Normalize the LLM-friendly `context_variables` shape to the SFAP wire
 * shape expected by the /v1.1/preview/sessions/{sid}/messages endpoint.
 *
 * - default `type` to 'Text' when omitted (matches eval-spec convention)
 * - stringify primitive values; the SFAP variables array is string-typed
 *   on the wire, mirroring how the eval API serializes context_variables
 *
 * Returns [] when `vars` is empty/undefined so the body shape is unchanged
 * for callers that don't pass any seeds.
 */
export function normalizeContextVariables(
  vars: ContextVariable[] | undefined,
): Array<{ name: string; type: string; value: string }> {
  if (!vars || vars.length === 0) return [];
  return vars.map((v) => ({
    name: v.name,
    type: v.type ?? "Text",
    value: typeof v.value === "string" ? v.value : String(v.value),
  }));
}

export function computePublishedBypassUser(bot?: {
  AgentType?: string;
  BotUserId?: string | null;
}): boolean {
  if (bot?.AgentType === "AgentforceEmployeeAgent") return false;
  return Boolean(bot?.BotUserId);
}

function isInvalidUserIdStartFailure(resp: { status: number; body: unknown }): boolean {
  if (resp.status < 400) return false;
  const text = typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body ?? {});
  return /Invalid user ID provided on start session/i.test(text);
}

// Note: the previous `extractTopicAndActions()` helper read the wrong field
// names (`steps` vs the runtime's `plan`, `FunctionCallStep` vs the
// runtime's `FunctionStep`) and only surfaced two fields to the LLM. It
// was replaced by `summarizeTrace()` in `./trace-digest.ts`, which keeps
// every step type and emits a compact one-row-per-step digest. Topic +
// invokedActions are still derived from the digest for back-compat.

// -------------------------------------------------------------------------------------------------
// startPreviewByApiName — converse with a published, activated agent
// -------------------------------------------------------------------------------------------------

export async function startPreviewByApiName(
  opts: PreviewStartByApiNameOptions,
): Promise<PreviewStartResult> {
  // Pre-flight: one SOQL covers BotDefinition existence + AgentType +
  // BotUserId (for the bypassUser decision) + the latest BotVersion's
  // Status. Lets us return clean diagnostics instead of the server's
  // confusing 412 "No access to Einstein Copilot" / 404 / 500s.
  const r = await opts.conn.query<{
    Id: string;
    AgentType?: string;
    BotUserId?: string | null;
    BotVersions?: {
      records?: Array<{
        Id?: string;
        DeveloperName?: string | null;
        Status?: string | null;
        VersionNumber?: number | null;
      }>;
    } | null;
  }>(
    `SELECT Id, AgentType, BotUserId, ` +
      `(SELECT Id, DeveloperName, Status, VersionNumber FROM BotVersions ` +
      `ORDER BY VersionNumber DESC LIMIT 1) ` +
      `FROM BotDefinition WHERE DeveloperName='${soqlEscape(opts.agentApiName)}'`,
  );
  const bot = r.records[0];
  const botId = bot?.Id;
  if (!botId) {
    throw new Error(
      `Agent '${opts.agentApiName}' not found in the org. Use agentscript_lifecycle action='list_versions' to discover agents.`,
    );
  }
  // Inactive latest version → SFAP returns a confusing 412 "No access to
  // Einstein Copilot". Catch it here with an actionable message.
  const latestVersion = bot.BotVersions?.records?.[0];
  if (latestVersion && latestVersion.Status !== "Active") {
    const v = latestVersion.VersionNumber ?? "?";
    throw new Error(
      `Agent '${opts.agentApiName}' has no active BotVersion ` +
        `(latest is v${v}, Status='${latestVersion.Status ?? "unknown"}'). ` +
        `Activate it first: agentscript_lifecycle action='activate' ` +
        `agent_api_name='${opts.agentApiName}' version=${v}.`,
    );
  }
  if (!latestVersion) {
    throw new Error(
      `Agent '${opts.agentApiName}' exists but has no BotVersions. ` +
        `Publish first: agentscript_lifecycle action='publish' ` +
        `agent_file=<path to your .agent file>.`,
    );
  }

  const startBody = (bypassUser: boolean): Record<string, unknown> => ({
    externalSessionKey: randomUUID(),
    instanceConfig: { endpoint: opts.conn.instanceUrl },
    streamingCapabilities: { chunkTypes: ["Text"] },
    bypassUser,
  });
  const bypassUser = computePublishedBypassUser(bot);
  let sessionResp = await sfapRequest<SessionStartBody>(opts.conn, {
    url: PROD_AGENT_SESSION_URL(botId),
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: startBody(bypassUser),
  });
  if (bypassUser && isInvalidUserIdStartFailure(sessionResp)) {
    sessionResp = await sfapRequest<SessionStartBody>(opts.conn, {
      url: PROD_AGENT_SESSION_URL(botId),
      method: "POST",
      headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
      body: startBody(false),
    });
  }
  if (sessionResp.status < 200 || sessionResp.status >= 300) {
    const mapped = mapPreviewError(sessionResp.status, sessionResp.body, {
      phase: "start",
      surface: "api_name",
      agentApiName: opts.agentApiName,
    });
    throw new Error(mapped.message);
  }

  const startTime = new Date().toISOString();
  const sessionId = sessionResp.body.sessionId;
  if (!sessionId) {
    throw new Error("Production-agent session start returned no sessionId.");
  }
  // Persist the SFAP host that served `start` (api / test.api / dev.api)
  // and target-org so send/end/trace can route correctly without the
  // caller having to repeat `target_org` on every call.
  const sessionDir = await initSession(opts.cwd, {
    sessionId,
    agentName: opts.agentApiName,
    startTime,
    mockMode: "Live Test",
    sessionKind: "api_name",
    endpoint: sessionResp.endpoint,
    targetOrg: opts.targetOrg,
  });
  const initialMsg = (sessionResp.body.messages ?? []).map((m) => m.message ?? "").join("\n");
  await logTurn(sessionDir, {
    timestamp: startTime,
    agentName: opts.agentApiName,
    sessionId,
    role: "agent",
    text: initialMsg,
    raw: sessionResp.body.messages,
  });
  // Build a surface digest from the welcome message. The user input is
  // intentionally absent (the start call has no utterance) — the LLM
  // sees a digest with response_type / safety / planId only.
  const digest = summarizeProductionResponse(
    sessionResp.body.messages as Parameters<typeof summarizeProductionResponse>[0],
  );
  return { sessionId, agentResponse: initialMsg, startedAt: startTime, sessionDir, digest };
}

// Re-export read-side helpers for the preview tool.
export { loadSession } from "./session-store.ts";
export { cleanupSessions } from "./session-store.ts";
