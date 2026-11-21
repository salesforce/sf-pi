/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin-as-code depth on the public REST commands of Fin CLI 0.15.4+:
 *
 * - referenceIssues: checks `<use action>` and `<escalate to>` against the
 *   workspace's own `.fin/` rosters (exhaustive per Fin). Attributes are not
 *   checked: Fin filters that roster and temporary attributes are local.
 * - listAuthTokens: auth token metadata only (id, name, type) and which data
 *   connectors use each one. Secret values and prefixes never leave Fin.
 * - setConnectorState: plan or set a data connector live/draft through
 *   `data-connectors update`, then verify by reading it back.
 * - readConnectorLogs: recent execution results without bodies; Fin already
 *   redacts query parameters in the URL.
 * - deleteSimulation: plan or delete exactly one simulation, then verify.
 * - agentStatus: one agent's chain — procedure (state, channels), its
 *   connectors (state, tokens), simulations, and the next step.
 *
 * Every CLI call goes through `deps.run` (token in the child env only) after
 * `ensureFinSdkEnabled`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { finAdminConnectorUrl } from "../../../lib/common/fin-admin-surface.ts";
import type { FinCredential } from "./auth.ts";
import { classifyCliResult, readCliErrorMessage } from "./cli-runner.ts";
import { ensureFinSdkEnabled, type SdkReadDeps } from "./sdk-reads.ts";

export interface WorkspaceResult {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

const ID = /^\d+$/;

// ─── Reference validation ──────────────────────────────────────────────────

export interface ReferenceIssue {
  path: string;
  message: string;
}

/** Workspace reference dir for an SDK download: `<sdk dir>/resources/.fin`. */
export function referenceDir(sdkDir: string): string {
  return path.join(sdkDir, "resources", ".fin");
}

/**
 * Names a procedure refers to that the workspace does not have. `actions.txt`,
 * `teams.json`, and `admins.json` are exhaustive per Fin, so a missing name
 * fails Fin's save; checking locally catches it before upload.
 */
export function referenceIssues(doc: unknown, finDir: string): ReferenceIssue[] {
  const actionsFile = path.join(finDir, "actions.txt");
  const teamsFile = path.join(finDir, "teams.json");
  const adminsFile = path.join(finDir, "admins.json");
  if (!existsSync(actionsFile) || !existsSync(teamsFile) || !existsSync(adminsFile)) return [];
  const actions = new Set(
    readFileSync(actionsFile, "utf8")
      .split("\n")
      .map((line) => line.split(" - ")[0]?.trim())
      .filter((name): name is string => Boolean(name)),
  );
  const names = (file: string) =>
    new Set(
      (safeJsonFile(file) ?? [])
        .map((entry) =>
          entry && typeof entry === "object" ? (entry as { name?: unknown }).name : undefined,
        )
        .filter((name): name is string => typeof name === "string"),
    );
  const handoff = new Set([...names(teamsFile), ...names(adminsFile)]);
  const text = JSON.stringify((doc as { procedure?: unknown })?.procedure ?? doc);
  const issues: ReferenceIssue[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/<use action=\\"([^"\\]+)\\"/g)) {
    const name = match[1] ?? "";
    if (actions.has(name) || seen.has(`a:${name}`)) continue;
    seen.add(`a:${name}`);
    issues.push({
      path: "/procedure",
      message: `<use action="${name}"> — "${name}" is not a live data connector in this workspace (.fin/actions.txt lists live ones; a draft connector is invisible to Fin until it is live).`,
    });
  }
  for (const match of text.matchAll(/<escalate to=\\"([^"\\]+)\\"/g)) {
    const name = match[1] ?? "";
    if (handoff.has(name) || seen.has(`e:${name}`)) continue;
    seen.add(`e:${name}`);
    issues.push({
      path: "/procedure",
      message: `<escalate to="${name}"> — "${name}" is not a team or teammate in this workspace (.fin/teams.json, .fin/admins.json); Fin rejects the save.`,
    });
  }
  return issues;
}

// ─── Auth tokens ───────────────────────────────────────────────────────────

interface TokenRow {
  id: string;
  name: string;
  type?: string;
  connectors: string[];
}

export async function listAuthTokens(
  credential: FinCredential,
  deps: SdkReadDeps,
  signal?: AbortSignal,
): Promise<WorkspaceResult> {
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  const listed = await call(credential, deps, ["auth-tokens", "list", "--json"], signal);
  if (listed.ok === false) return fail("auth-tokens list", listed.error);
  const connectors = await connectorsWithTokens(credential, deps, signal);
  // A connector that could not be read is unknown, never "uses no token".
  const unread = connectors.filter((c) => !c.read).map((c) => `${c.name} (${c.id})`);
  const tokens: TokenRow[] = asList(listed.json).map((t) => {
    const id = str(t.id) ?? "?";
    return {
      id,
      name: str(t.name) ?? "(unnamed)",
      type: str(t.token_type),
      connectors: connectors.filter((c) => c.tokens.includes(id)).map((c) => `${c.name} (${c.id})`),
    };
  });
  return {
    ok: true,
    text: [
      `Fin auth tokens: ${tokens.length}`,
      ...tokens.map(
        (t) =>
          `- ${t.name} [${t.id}]${t.type ? ` · ${t.type}` : ""} · used by ${t.connectors.length ? t.connectors.join(", ") : unread.length ? "unknown (see below)" : "no connector"}`,
      ),
      ...(unread.length
        ? [`⚠️ could not read ${unread.join(", ")}; its token binding is unknown. Retry.`]
        : []),
      "Secret values are never read. Bind a connector to a token with its `auth_token_id` in the connector JSON, then check it with sdk operation='agent_status'.",
    ].join("\n"),
    details: { phase: "list", tokens, ...(unread.length ? { unreadConnectors: unread } : {}) },
  };
}

// ─── Connector state ───────────────────────────────────────────────────────

export async function setConnectorState(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { connectorId: string; target: "live" | "draft"; execute: boolean },
  signal?: AbortSignal,
): Promise<WorkspaceResult> {
  if (!ID.test(input.connectorId)) {
    return fail(
      "connector_state",
      "connector_id must be an exact numeric data connector id.",
      "input",
    );
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  const before = await readConnector(credential, deps, input.connectorId, signal);
  if (before.ok === false) return fail("data-connectors get", before.error);
  const label = `"${before.name}" (${input.connectorId})`;
  const base = { connectorId: input.connectorId, from: before.state, to: input.target };
  if (before.state === input.target) {
    const editor =
      input.target === "live" && deps.appId
        ? safeConnectorUrl(credential, deps.appId, input.connectorId)
        : undefined;
    return {
      ok: true,
      text: [
        `✅ Data connector ${label} is already ${before.state}. Nothing to do.`,
        input.target === "live"
          ? `If it has unpublished changes (for example from sdk upload), the public API cannot publish them: test the edit in Fin's connector editor and click "Set changes live"${editor ? ` (${editor})` : " (Settings → Data connectors → this connector)"}.`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      details: { phase: "noop", ...base, ...(editor ? { editor } : {}) },
    };
  }
  if (input.target === "live" && !before.url) {
    return {
      ok: false,
      text: `❌ Data connector ${label} has no request URL, so it is an incomplete draft. Upload its JSON (sdk upload) before setting it live.`,
      details: { phase: "refused", ...base },
    };
  }
  const tokenWarning =
    input.target === "live" && before.tokens.length === 0
      ? "⚠ It has no auth token: Fin calls the URL unauthenticated. Fine for a public API; otherwise bind `auth_token_id` first."
      : undefined;
  const effect =
    input.target === "live"
      ? "Fin can call it from live procedures and workflows immediately."
      : "Fin stops calling it; procedures that use it fail that step until it is live again.";
  if (!input.execute) {
    return {
      ok: true,
      text: [
        `Plan: set data connector ${label} ${before.state} → ${input.target} through the public data connectors API.`,
        effect,
        tokenWarning,
        `To proceed, call sf_fin action='sdk' operation='connector_state' connector_id='${input.connectorId}' state='${input.target}' allow_mutation=true (SF Guardrail mediates it).`,
      ]
        .filter(Boolean)
        .join("\n"),
      details: { phase: "plan", ...base, tokens: before.tokens.length },
    };
  }
  const updated = await call(
    credential,
    deps,
    ["data-connectors", "update", input.connectorId, "-f", `state=${input.target}`, "--json"],
    signal,
  );
  if (updated.ok === false) {
    return {
      ok: false,
      text: `❌ Setting ${label} ${input.target} failed: ${updated.error}`,
      details: { phase: "execute", ...base },
    };
  }
  const after = await readConnector(credential, deps, input.connectorId, signal);
  const observed = after.ok ? after.state : undefined;
  if (observed !== input.target) {
    return {
      ok: false,
      text: `⚠ Fin accepted the change for ${label}, but reports state ${observed ?? "unknown"} instead of ${input.target}.`,
      details: { phase: "verify", ...base, observed },
    };
  }
  return {
    ok: true,
    text: [`✅ Data connector ${label} is now ${observed} (was ${before.state}).`, effect].join(
      "\n",
    ),
    details: { phase: "execute", ...base, observed },
  };
}

// ─── Connector logs ────────────────────────────────────────────────────────

export async function readConnectorLogs(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { connectorId: string; sinceHours?: number },
  signal?: AbortSignal,
): Promise<WorkspaceResult> {
  if (!ID.test(input.connectorId)) {
    return fail(
      "connector_logs",
      "connector_id must be an exact numeric data connector id.",
      "input",
    );
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  const hours = Math.max(1, Math.min(24 * 30, Math.floor(input.sinceHours ?? 24)));
  const since = Math.floor(deps.now().getTime() / 1000) - hours * 3600;
  // Bodies are never requested: they can hold customer data.
  const listed = await call(
    credential,
    deps,
    [
      "data-connectors",
      "list-execution-results",
      input.connectorId,
      "--start-ts",
      String(since),
      "--per-page",
      "50",
      "--json",
    ],
    signal,
  );
  if (listed.ok === false) return fail("data-connectors list-execution-results", listed.error);
  const runs = asList(listed.json).map((r) => ({
    id: str(r.id),
    success: r.success === true,
    status: typeof r.http_status === "number" ? r.http_status : undefined,
    error: str(r.error_type),
    method: str(r.http_method),
    url: str(r.request_url),
    ms: typeof r.execution_time_ms === "number" ? r.execution_time_ms : undefined,
    source: [str(r.source_type), str(r.source_id)].filter(Boolean).join(" "),
    at: str(r.created_at),
  }));
  const failed = runs.filter((r) => !r.success).length;
  return {
    ok: true,
    text: [
      `Data connector ${input.connectorId}: ${runs.length} run${runs.length === 1 ? "" : "s"} in the last ${hours}h, ${failed} failed.`,
      ...runs
        .slice(0, 20)
        .map(
          (r) =>
            `${r.success ? "✅" : "❌"} ${r.at ?? "?"} · ${r.status ?? "?"}${r.error ? ` ${r.error}` : ""} · ${r.ms ?? "?"}ms · ${r.source || "unknown source"}`,
        ),
    ].join("\n"),
    details: {
      phase: "logs",
      connectorId: input.connectorId,
      hours,
      total: runs.length,
      failed,
      runs,
    },
  };
}

// ─── Simulation delete ─────────────────────────────────────────────────────

export async function deleteSimulation(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { procedureId: string; testId: string; execute: boolean },
  signal?: AbortSignal,
): Promise<WorkspaceResult> {
  if (!ID.test(input.procedureId) || !ID.test(input.testId)) {
    return fail(
      "simulations_delete",
      "procedure_id and test_id must be exact numeric ids.",
      "input",
    );
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  const tests = await listTests(credential, deps, input.procedureId, signal);
  if (tests.ok === false) return fail("simulations list", tests.error);
  const target = tests.tests.find((t) => t.id === input.testId);
  if (!target) {
    return {
      ok: false,
      text: `❌ Procedure ${input.procedureId} has no simulation ${input.testId}.`,
      details: { phase: "not_found", procedureId: input.procedureId, testId: input.testId },
    };
  }
  const label = `"${target.name ?? "(unnamed)"}" [${input.testId}]`;
  if (!input.execute) {
    return {
      ok: true,
      text: [
        `Plan: delete simulation ${label} from procedure ${input.procedureId} (${tests.tests.length} → ${tests.tests.length - 1} tests).`,
        "Deletion cannot be undone; re-upload the test to recreate it.",
        `To proceed, call sf_fin action='sdk' operation='simulations_delete' procedure_id='${input.procedureId}' test_id='${input.testId}' allow_mutation=true (SF Guardrail mediates it).`,
      ].join("\n"),
      details: {
        phase: "plan",
        procedureId: input.procedureId,
        testId: input.testId,
        name: target.name,
      },
    };
  }
  const deleted = await call(
    credential,
    deps,
    ["fin", "simulations", "delete", input.procedureId, input.testId, "--json"],
    signal,
  );
  if (deleted.ok === false) {
    return {
      ok: false,
      text: `❌ Deleting simulation ${label} failed: ${deleted.error}`,
      details: { phase: "execute", procedureId: input.procedureId, testId: input.testId },
    };
  }
  const after = await listTests(credential, deps, input.procedureId, signal);
  const gone = after.ok && !after.tests.some((t) => t.id === input.testId);
  return {
    ok: gone,
    text: gone
      ? `✅ Deleted simulation ${label}; procedure ${input.procedureId} now has ${after.ok ? after.tests.length : "?"} simulation(s).`
      : `⚠ Fin accepted the delete, but simulation ${label} is still listed.`,
    details: {
      phase: gone ? "execute" : "verify",
      procedureId: input.procedureId,
      testId: input.testId,
      remaining: after.ok ? after.tests.length : undefined,
    },
  };
}

// ─── Agent status ──────────────────────────────────────────────────────────

export async function agentStatus(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { procedureId: string },
  signal?: AbortSignal,
): Promise<WorkspaceResult> {
  if (!ID.test(input.procedureId)) {
    return fail("agent_status", "procedure_id must be an exact numeric Fin procedure id.", "input");
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  const got = await deps.run(["fin", "procedures", "get", input.procedureId], {
    credential,
    signal,
    timeoutMs: 60_000,
  });
  if (classifyCliResult(got) !== "ok") {
    return fail("procedures get", readCliErrorMessage(got) ?? "procedure not found");
  }
  const doc = (safeYaml(got.stdout) ?? {}) as Record<string, unknown>;
  const text = JSON.stringify(doc.procedure ?? {});
  const actionNames = [
    ...new Set([...text.matchAll(/<use action=\\"([^"\\]+)\\"/g)].map((m) => m[1] ?? "")),
  ];
  const channels = Array.isArray((doc.targeting as { channels?: unknown })?.channels)
    ? ((doc.targeting as { channels: unknown[] }).channels.filter(
        (c) => typeof c === "string",
      ) as string[])
    : [];
  const [connectorRows, tokenList, tests, workflows] = await Promise.all([
    connectorsWithTokens(credential, deps, signal),
    call(credential, deps, ["auth-tokens", "list", "--json"], signal),
    listTests(credential, deps, input.procedureId, signal),
    call(credential, deps, ["fin", "workflows", "list", "--json"], signal),
  ]);
  const tokenNames = new Map(
    (tokenList.ok ? asList(tokenList.json) : []).map((t) => [str(t.id) ?? "", str(t.name) ?? ""]),
  );
  const connectors = actionNames.map((name) => {
    const row = connectorRows.find((c) => c.name === name);
    return row
      ? {
          id: row.id,
          name,
          state: row.state,
          tokens: row.tokens.map((id) => tokenNames.get(id) || id),
          read: row.read,
        }
      : { id: undefined, name, state: "missing", tokens: [] as string[], read: true };
  });
  const wf = workflows.ok ? asList(workflows.json) : [];
  const procedure = {
    id: input.procedureId,
    name: str(doc.name) ?? input.procedureId,
    state: str(doc.state) ?? "unknown",
    unpublished: doc.has_unpublished_changes === true,
    version: str(doc.version),
  };
  const simulations = tests.ok ? tests.tests.length : undefined;
  const next = nextAgentStep(procedure, channels, connectors, simulations);
  const lines = [
    `Agent: ${procedure.name} (procedure ${procedure.id}) · ${procedure.state}${procedure.unpublished ? " + unpublished draft" : ""}`,
    `Channels: ${channels.length ? channels.join(", ") : "all"}${channels.includes("fin_agent_api") ? " (Fin Agent API: run by procedure id or matched by intent; not run by channel workflows)" : ""}`,
    ...connectors.map(
      (c) =>
        `Connector: ${c.name}${c.id ? ` (${c.id})` : ""} · ${c.state}${c.tokens.length ? ` · token ${c.tokens.join(", ")}` : !c.read ? " · token unknown (could not read the connector)" : c.state !== "missing" ? " · no auth token" : ""}`,
    ),
    `Simulations: ${simulations ?? "unknown"}`,
    ...(channels.includes("fin_agent_api")
      ? []
      : wf.map(
          (w) =>
            `Workflow: ${str(w.title) ?? str(w.name) ?? "?"} (${str(w.id) ?? "?"}) · ${str(w.state) ?? "?"} · ${str(w.trigger_type) ?? "?"}`,
        )),
    `Next: ${next}`,
  ];
  return {
    ok: true,
    text: lines.join("\n"),
    details: {
      phase: "status",
      procedure,
      channels,
      connectors,
      simulations,
      workflows: wf.map((w) => ({
        id: str(w.id),
        title: str(w.title),
        state: str(w.state),
        trigger: str(w.trigger_type),
      })),
      next,
    },
  };
}

function nextAgentStep(
  procedure: { id: string; state: string; unpublished: boolean },
  channels: string[],
  connectors: Array<{ id?: string; name: string; state: string; tokens: string[] }>,
  simulations: number | undefined,
): string {
  const missing = connectors.find((c) => c.state === "missing");
  if (missing)
    return `create and upload the data connector "${missing.name}" (sdk create_data_connector, then upload).`;
  const draft = connectors.find((c) => c.state !== "live");
  if (draft) {
    return `set data connector "${draft.name}" live: sf_fin sdk connector_state connector_id='${draft.id}' state='live' (plan first).`;
  }
  if (!simulations)
    return "write a simulation set and run sdk upload_simulations, then sdk simulate.";
  if (procedure.state !== "live") {
    return `run sdk simulate procedure_id='${procedure.id}' (tests the draft); publish only when the user wants it live.`;
  }
  if (procedure.unpublished)
    return `simulate the draft, then sdk publish procedure_id='${procedure.id}' to release it.`;
  return channels.includes("fin_agent_api")
    ? `test it end to end with sf_fin agent run procedure_id='${procedure.id}'.`
    : "watch it in production conversations.";
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function safeConnectorUrl(
  credential: FinCredential,
  appId: string,
  connectorId: string,
): string | undefined {
  try {
    return finAdminConnectorUrl(credential.region, appId, connectorId);
  } catch {
    return undefined;
  }
}

async function call(
  credential: FinCredential,
  deps: SdkReadDeps,
  args: string[],
  signal?: AbortSignal,
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  const result = await deps.run(args, { credential, signal, timeoutMs: 90_000 });
  if (classifyCliResult(result) !== "ok") {
    return {
      ok: false,
      error: readCliErrorMessage(result) ?? `${args.slice(0, 2).join(" ")} failed.`,
    };
  }
  try {
    return { ok: true, json: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, error: `${args.slice(0, 2).join(" ")} returned no JSON.` };
  }
}

async function readConnector(
  credential: FinCredential,
  deps: SdkReadDeps,
  id: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; name: string; state: string; tokens: string[]; url: string }
  | { ok: false; error: string }
> {
  const got = await call(credential, deps, ["data-connectors", "get", id, "--json"], signal);
  if (got.ok === false) return got;
  const record = (got.json ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    name: str(record.name) ?? id,
    state: str(record.state) ?? "unknown",
    tokens: Array.isArray(record.token_ids) ? record.token_ids.map(String) : [],
    url: str(record.url) ?? "",
  };
}

async function connectorsWithTokens(
  credential: FinCredential,
  deps: SdkReadDeps,
  signal?: AbortSignal,
): Promise<Array<{ id: string; name: string; state: string; tokens: string[]; read: boolean }>> {
  const listed = await call(credential, deps, ["data-connectors", "list", "--json"], signal);
  if (listed.ok === false) return [];
  const rows = asList(listed.json).slice(0, 50);
  return Promise.all(
    rows.map(async (row) => {
      const id = str(row.id) ?? "";
      const detail = await readConnector(credential, deps, id, signal);
      return {
        id,
        name: str(row.name) ?? id,
        state: detail.ok ? detail.state : (str(row.state) ?? "unknown"),
        tokens: detail.ok ? detail.tokens : [],
        read: detail.ok,
      };
    }),
  );
}

async function listTests(
  credential: FinCredential,
  deps: SdkReadDeps,
  procedureId: string,
  signal?: AbortSignal,
): Promise<
  { ok: true; tests: Array<{ id: string; name?: string }> } | { ok: false; error: string }
> {
  const listed = await deps.run(["fin", "simulations", "list", procedureId], {
    credential,
    signal,
    timeoutMs: 60_000,
  });
  if (classifyCliResult(listed) !== "ok") {
    return { ok: false, error: readCliErrorMessage(listed) ?? "simulations list failed." };
  }
  const set = safeYaml(listed.stdout) as { tests?: unknown } | undefined;
  const tests = Array.isArray(set?.tests) ? (set.tests as Array<Record<string, unknown>>) : [];
  return {
    ok: true,
    tests: tests.flatMap((t) => {
      const id = str(t?.id);
      return id ? [{ id, name: str(t.name) }] : [];
    }),
  };
}

function asList(json: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(json)) return json as Array<Record<string, unknown>>;
  const record = (json ?? {}) as Record<string, unknown>;
  for (const key of ["data", "workflows", "items"]) {
    if (Array.isArray(record[key])) return record[key] as Array<Record<string, unknown>>;
  }
  return [];
}

function fail(what: string, error: string, phase = "read"): WorkspaceResult {
  return { ok: false, text: `❌ ${what}: ${error}`, details: { phase } };
}

function str(value: unknown): string | undefined {
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function safeYaml(text: string): unknown {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}

function safeJsonFile(file: string): unknown[] | undefined {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
