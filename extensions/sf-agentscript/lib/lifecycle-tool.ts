/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_lifecycle — multi-action publish/activate lifecycle.
 *
 * Closes the dev loop. After compile + inspect + mutate + preview + eval,
 * this is the verb that actually ships the agent to the org.
 *
 * Actions:
 *   publish        Server-compile + create new agent OR new version of an
 *                  existing agent (auto-detected). Optionally activate the
 *                  new version in the same call.
 *   activate       Activate a specific version (or the latest).
 *   deactivate     Deactivate a specific version (or the latest).
 *   list_versions  Enumerate every BotVersion for an agent in the org.
 *
 * Auth: @salesforce/core Connection.
 * Local-first: publish pre-flights via the local SDK before the server call.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "./agent-api-auth.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import {
  checkAgentUserStatus,
  readAgentConfigSlice,
  runDiagnose,
  runProvision,
  type AgentUserStatus,
  type DiagnoseReport,
  type ProvisionReport,
  type ProvisionStep,
} from "./agent-user/index.ts";
import { checkAgentScriptFile } from "./diagnostics.ts";
import { inspectFile } from "./inspect.ts";
import { mapAgentApiError } from "./errors/agent-api-error-map.ts";
import { buildFeatureProfile, type AgentFeatureProfile } from "./feature-profile.ts";
import { sfap404Message } from "./errors/sfap-404.ts";
import { checkBundleVsBotDivergence } from "./lifecycle-divergence.ts";
import {
  agentFileEvent,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "./branch-state.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import { activateVersion, deactivateVersion, listVersions, publishAgent } from "./lifecycle.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "./tool-types.ts";
import { renderLifecycleCall, renderLifecycleResult } from "./render/lifecycle.ts";

export const LIFECYCLE_TOOL_NAME = "agentscript_lifecycle";

// Single Type.Object: emits root `type:"object"` so OpenAI's strict tool
// validator accepts it. Per-action required-field checks happen in execute().
const Params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("publish"),
      Type.Literal("activate"),
      Type.Literal("deactivate"),
      Type.Literal("list_versions"),
      Type.Literal("agent_user_status"),
      Type.Literal("diagnose_agent_user"),
      Type.Literal("provision_agent_user"),
    ],
    {
      description:
        "publish: ship a .agent file as a new agent or new version. activate / deactivate: toggle a BotVersion's Status (idempotent). list_versions: return every BotVersion on the agent. agent_user_status: cheap ready/not_ready/n/a preflight on the agent's user wiring. diagnose_agent_user: full read-only checklist (license, user, system PS, per-apex-class access). provision_agent_user: idempotently bring the org up to spec (creates user, assigns system PS, deploys + assigns custom PS for apex actions). Defaults to dry_run=true; pass dry_run=false to mutate.",
    },
  ),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias / username." })),
  agent_file: Type.Optional(
    Type.String({
      description:
        "Required for action='publish'. Optional for action='activate' — when provided, runs a divergence check (warns when local .agent is newer than the BotVersion you're activating; flags the 'sf project deploy doesn't propagate config' footgun). Required for agent_user_status / diagnose_agent_user / provision_agent_user.",
    }),
  ),
  agent_api_name: Type.Optional(
    Type.String({
      description:
        "Required for activate/deactivate/list_versions. Optional for publish (defaults to basename of agent_file without .agent).",
    }),
  ),
  activate: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='publish'. Immediately activate the new version. Default false.",
    }),
  ),
  version: Type.Optional(
    Type.Number({
      minimum: 1,
      description:
        "Optional for activate/deactivate. Defaults to the latest BotVersion on the agent.",
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description:
        "For action='provision_agent_user'. Default true (preview the plan, no mutations). Pass false to actually create the user / assign PSs / deploy custom PS.",
    }),
  ),
  username_override: Type.Optional(
    Type.String({
      description:
        "Optional for action='provision_agent_user'. Provision a specific username instead of the .agent's default_agent_user. Useful when the bundle was authored against a different name than what the org provides.",
    }),
  ),
});

interface ParamsAny {
  action:
    | "publish"
    | "activate"
    | "deactivate"
    | "list_versions"
    | "agent_user_status"
    | "diagnose_agent_user"
    | "provision_agent_user";
  target_org?: string;
  agent_file?: string;
  agent_api_name?: string;
  activate?: boolean;
  version?: number;
  dry_run?: boolean;
  username_override?: string;
}

function checkRequired(p: ParamsAny): { ok: true } | { ok: false; error: string } {
  switch (p.action) {
    case "publish":
      if (!p.agent_file) return { ok: false, error: "action='publish' requires agent_file." };
      return { ok: true };
    case "activate":
    case "deactivate":
    case "list_versions":
      if (!p.agent_api_name)
        return { ok: false, error: `action='${p.action}' requires agent_api_name.` };
      return { ok: true };
    case "agent_user_status":
      if (!p.agent_file)
        return { ok: false, error: "action='agent_user_status' requires agent_file." };
      return { ok: true };
    case "diagnose_agent_user":
      if (!p.agent_file)
        return { ok: false, error: "action='diagnose_agent_user' requires agent_file." };
      return { ok: true };
    case "provision_agent_user":
      if (!p.agent_file)
        return { ok: false, error: "action='provision_agent_user' requires agent_file." };
      return { ok: true };
  }
}

export function registerLifecycleTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: LIFECYCLE_TOOL_NAME,
    label: "Agent Script lifecycle",
    description:
      "Multi-action publish lifecycle: publish a `.agent` (creates new agent or new version), activate / deactivate a specific version, or list every version on an agent in the org. Local pre-flight before server publish; SOQL-backed list_versions; idempotent activate.",
    renderCall: renderLifecycleCall,
    renderResult: renderLifecycleResult,
    promptSnippet: "Ship a .agent file to the org and toggle version activation.",
    promptGuidelines: [
      "action='publish' — pass agent_file (the .agent path). Auto-detects new-agent vs new-version. Set activate=true to chain publish+activate in one call. Service Agents get a free agent_user_status preflight — a missing user / PS aborts with a clean recover_via, no SFAP round-trip.",
      "action='activate' / 'deactivate' — pass agent_api_name; omit version for the latest. Idempotent: a no-op when already in the requested state.",
      "action='list_versions' — returns every BotVersion (id, number, status, dates). Use to discover which version is Active before previewing or running eval.",
      "action='agent_user_status' — cheap read-only check (~2 SOQL hits) that a Service Agent's user wiring is ready before publish. Returns status: ready/not_ready/n/a; not_ready surfaces a stable 'reason' code so the LLM can chain the right fix verb.",
      "action='diagnose_agent_user' — full read-only checklist (license, user existence + active state, system PS, per-apex-class access). Returns a structured report with per-check status + fix_hint. Use when agent_user_status returns not_ready and you want the full picture before fixing.",
      "action='provision_agent_user' — idempotent provisioner that brings the org into the 'ready' state. Defaults to dry_run=true (returns the plan + the rendered custom PS XML, no mutations). Pass dry_run=false to execute. Steps: create User if missing, assign AgentforceServiceAgentUser system PS, synthesize + deploy custom PS covering every apex:// target, assign custom PS. Skip-if-already-done at every step. License-missing aborts cleanly (admin-only fix).",
      "Errors carry recover_via where applicable (e.g. agent not found → list_versions hint, Service Agent missing user → diagnose_agent_user / provision_agent_user).",
      "No sf CLI subprocess: every primitive runs through @salesforce/core Connection + @salesforce/source-deploy-retrieve. Safe in CI / programmatic contexts.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const p = params as ParamsAny;
      const stream = (msg: string): void => {
        try {
          onUpdate?.({
            content: [{ type: "text", text: msg }],
            details: { progress: msg } as never,
          });
        } catch {
          /* best-effort */
        }
      };
      const reqOk = checkRequired(p);
      if (reqOk.ok === false) return toolError("INVALID_PARAMS", reqOk.error);
      switch (p.action) {
        case "publish":
          return await actionPublish(ctx, p, stream);
        case "activate":
          return await actionActivate(ctx, p);
        case "deactivate":
          return await actionDeactivate(p);
        case "list_versions":
          return await actionListVersions(p);
        case "agent_user_status":
          return await actionAgentUserStatus(ctx, p);
        case "diagnose_agent_user":
          return await actionDiagnoseAgentUser(ctx, p);
        case "provision_agent_user":
          return await actionProvisionAgentUser(ctx, p, stream);
      }
    },
  });
}

function lifecycleVersionEvents(input: {
  agentApiName: string;
  agentFile?: string;
  botId?: string;
  botVersionId?: string;
  versionNumber?: number;
  status?: string;
  source: string;
}): AgentScriptBranchStateEvent[] {
  return [
    ...(input.agentFile ? [agentFileEvent(input.agentFile, input.source)] : []),
    {
      schema_version: 1 as const,
      kind: "lifecycle_version" as const,
      agent_api_name: input.agentApiName,
      agent_file: input.agentFile,
      bot_id: input.botId,
      bot_version_id: input.botVersionId,
      version_number: input.versionNumber,
      status: input.status,
      source: input.source,
    },
  ];
}

// -------------------------------------------------------------------------------------------------
// action = publish
// -------------------------------------------------------------------------------------------------

async function actionPublish(
  ctx: ExtensionContext,
  input: ParamsAny,
  stream: (msg: string) => void,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }

  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (err) {
    return toolError(
      `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const localCheck = await checkAgentScriptFile(filePath);
  if (!localCheck.ok) {
    return toolError(
      localCheck.unavailableReason ?? "Local Agent Script compile failed before publish.",
      "Run agentscript_authoring compile/check to see the full diagnostic details.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }
  const blocking = localCheck.diagnostics.filter((d) => d.severity === 1);
  if (blocking.length > 0) {
    return toolError(
      `Local diagnostics rejected publish (${blocking.length} severity-1 issue${blocking.length === 1 ? "" : "s"}).`,
      "Run agentscript_authoring compile/check to see and fix the diagnostics before publishing.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }

  const agentApiName = input.agent_api_name ?? path.basename(filePath, ".agent");
  let featureProfile: AgentFeatureProfile | undefined;
  try {
    const inspect = await inspectFile(filePath);
    if (inspect.ok) {
      featureProfile = buildFeatureProfile(inspect);
      for (const risk of featureProfile.publish_risks) {
        stream(`Pre-flight warning — ${risk.message}`);
      }
    }
  } catch {
    // Feature-risk classification is advisory. Publish preflight below still runs.
  }

  // The bundle directory contains both the `.agent` file and the
  // `.bundle-meta.xml` file. SDR's ComponentSet.fromSource(bundleDir)
  // walks both and zips them up for the deploy().
  const bundleDir = path.dirname(filePath);

  try {
    const conn = await connFromAlias(input.target_org);

    // Service-Agent preflight: a missing/inactive user or unassigned
    // system PS is the #1 reason publish fails with a cryptic message.
    // Doing the cheap check here lets us return a clean recover_via
    // before the SFAP round-trip. Employee Agents return status='n/a'
    // and we proceed without disruption. See agent-user-setup.md skill.
    const cfg = await readAgentConfigSlice(filePath);
    if (cfg.ok && cfg.agent_type === "AgentforceServiceAgent") {
      const status = await checkAgentUserStatus(conn, {
        agent_type: cfg.agent_type,
        default_agent_user: cfg.default_agent_user,
      });
      if (!status.ok) {
        stream(`Pre-flight — Service Agent user wiring: ${status.short_message}`);
        return toolError(
          `Service Agent preflight failed: ${status.short_message}`,
          "Run agentscript_lifecycle action='diagnose_agent_user' to see the full checklist, then 'provision_agent_user' (defaults to dry_run=true) to fix.",
          {
            tool: LIFECYCLE_TOOL_NAME,
            params: {
              action: "agent_user_status",
              agent_file: filePath,
              ...(input.target_org ? { target_org: input.target_org } : {}),
            },
          },
        );
      }
    }
    const { conn: agentApiConn } = await connForAgentApi(input.target_org);
    const result = await publishAgent({
      conn,
      agentApiConn,
      agentSource: source,
      agentFilePath: filePath,
      bundleDir,
      agentApiName,
      activate: input.activate ?? false,
      log: stream,
    });
    const ab = result.authoring_bundle;
    const bundleLine = ab
      ? ab.error
        ? `  ⚠️ AiAuthoringBundle deploy failed (Agent Script Studio will fall back to legacy builder): ${ab.error.slice(0, 200)}`
        : `  • AiAuthoringBundle ${ab.full_name} deployed (target=${ab.target}, ${ab.created ? "created" : "updated"})`
      : null;
    const missing = result.preflight?.missing_action_targets ?? [];
    const preflightLines: string[] = [];
    for (const risk of featureProfile?.publish_risks ?? []) {
      preflightLines.push(`  ⚠️ ${risk.message}`);
      for (const evidence of risk.evidence.slice(0, 3)) {
        preflightLines.push(`     • ${evidence}`);
      }
    }
    if (missing.length > 0) {
      preflightLines.push(
        `  ⚠️ ${missing.length} action target(s) missing in org (preview will fail until deployed):`,
      );
      for (const m of missing.slice(0, 4)) {
        preflightLines.push(`     • ${m.name} → ${m.scheme}://${m.ref_name}`);
      }
      if (missing.length > 4) {
        preflightLines.push(`     …and ${missing.length - 4} more in details.preflight`);
      }
    }
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          agent_api_name: result.developer_name,
          bot_id: result.bot_id,
          bot_version_id: result.bot_version_id,
          version_developer_name: result.version_developer_name,
          was_new_agent: result.was_new_agent,
          activated: result.activated,
          authoring_bundle: result.authoring_bundle,
          ...(result.preflight ? { preflight: result.preflight } : {}),
          ...(featureProfile?.publish_risks.length
            ? { publish_risks: featureProfile.publish_risks }
            : {}),
        },
        lifecycleVersionEvents({
          agentApiName: result.developer_name,
          agentFile: filePath,
          botId: result.bot_id,
          botVersionId: result.bot_version_id,
          status: result.activated ? "Active" : undefined,
          source: "lifecycle.publish",
        }),
      ),
      [
        `📦 Published ${result.developer_name}`,
        result.was_new_agent ? "  • created new agent" : "  • new version of existing agent",
        `  • bot_version_id: ${result.bot_version_id}`,
        bundleLine,
        result.activated ? "  • activated ✓" : "  • not activated (set activate=true to chain)",
        ...preflightLines,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Pre-flight failure. The same exception class covers two distinct
    // checks (bundle XML, action targets); we route on the message prefix.
    if (err instanceof Error && err.name === "PreflightFailureError") {
      const path = (err as { path?: string }).path;
      if (/Bundle XML is invalid/i.test(msg)) {
        return toolError(
          msg,
          "Add `<bundleType>AGENT</bundleType>` inside `<AiAuthoringBundle>` and retry. " +
            "Scaffolds produced by `agentscript_authoring` create already include this field.",
          path
            ? {
                tool: "edit",
                params: { path, find: "<AiAuthoringBundle", replace: "<AiAuthoringBundle" },
              }
            : undefined,
        );
      }
      // Action-target preflight failure — point at check_targets so the LLM
      // can drill into the per-target breakdown without re-reading prose.
      return toolError(
        msg,
        "Run agentscript_authoring inspect/check_targets for a per-target breakdown. Then deploy the missing flows / apex classes and retry.",
        {
          tool: "agentscript_authoring",
          params: {
            verb: "inspect",
            mode: "check_targets",
            agent_file: filePath,
            target_org: input.target_org ?? "<alias>",
          },
        },
      );
    }
    if (/Local compile rejected/i.test(msg)) {
      return toolError(msg, undefined, {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      });
    }
    return classifyLifecycleError(err, agentApiName, "publish", filePath, featureProfile);
  }
}

// -------------------------------------------------------------------------------------------------
// action = activate / deactivate
// -------------------------------------------------------------------------------------------------

async function actionActivate(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // checkRequired guarantees agent_api_name is set for action='activate'.
  const agentApiName = input.agent_api_name as string;
  try {
    const conn = await connFromAlias(input.target_org);

    // Issue 6 — optional divergence preflight when caller passed agent_file.
    // Soft warning only: we surface it on the response but proceed with
    // the activation. The user may have intentionally activated an older
    // version (e.g. rollback); blocking would be too strict.
    let divergenceWarning: string | undefined;
    let divergenceDetails: Record<string, unknown> | undefined;
    if (input.agent_file) {
      const resolvedFile = safeResolveToolPath(input.agent_file, ctx.cwd);
      if ("absPath" in resolvedFile) {
        const div = await checkBundleVsBotDivergence(conn, agentApiName, resolvedFile.absPath);
        divergenceDetails = { ...div };
        if (div.ok && div.diverged) {
          divergenceWarning = `⚠️  ${div.detail}`;
        }
      }
    }

    const row = await activateVersion({
      conn,
      agentApiName,
      version: input.version,
    });
    // The agent is now reachable by the Eval API. Surface the next-step
    // hint so the LLM (or the human) knows how to lock the baseline
    // before iterating further.
    const orgFlag = input.target_org ? ` target_org='${input.target_org}'` : "";
    const evalHint =
      `\n\n→ Lock the regression baseline: ` +
      `agentscript_eval action='run' agent_api_name='${agentApiName}'${orgFlag} ` +
      `spec_path=<path-to-spec.json>`;
    const headerLines: string[] = [`🟢 ${agentApiName} v${row.VersionNumber} activated`];
    if (divergenceWarning) headerLines.push("", divergenceWarning);
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          agent_api_name: agentApiName,
          bot_version_id: row.Id,
          version_number: row.VersionNumber,
          status: row.Status,
          ...(divergenceDetails ? { divergence: divergenceDetails } : {}),
        },
        lifecycleVersionEvents({
          agentApiName,
          agentFile: input.agent_file,
          botVersionId: row.Id,
          versionNumber: row.VersionNumber,
          status: row.Status,
          source: "lifecycle.activate",
        }),
      ),
      headerLines.join("\n") + evalHint,
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "activate");
  }
}

async function actionDeactivate(input: ParamsAny): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const agentApiName = input.agent_api_name as string;
  try {
    const conn = await connFromAlias(input.target_org);
    const row = await deactivateVersion({
      conn,
      agentApiName,
      version: input.version,
    });
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          agent_api_name: agentApiName,
          bot_version_id: row.Id,
          version_number: row.VersionNumber,
          status: row.Status,
        },
        lifecycleVersionEvents({
          agentApiName,
          botVersionId: row.Id,
          versionNumber: row.VersionNumber,
          status: row.Status,
          source: "lifecycle.deactivate",
        }),
      ),
      `⚫ ${agentApiName} v${row.VersionNumber} deactivated`,
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "deactivate");
  }
}

// -------------------------------------------------------------------------------------------------
// action = list_versions
// -------------------------------------------------------------------------------------------------

async function actionListVersions(input: ParamsAny): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const agentApiName = input.agent_api_name as string;
  try {
    const conn = await connFromAlias(input.target_org);
    const result = await listVersions(conn, agentApiName);
    const lines = [
      `📋 Versions of ${result.agent_api_name} (bot_id ${result.bot_id})`,
      ...result.versions.map((v) => {
        const flag = v.status === "Active" ? "🟢" : "⚪";
        return `  ${flag} v${v.version_number} · ${v.status} · ${v.bot_version_id} · ${v.developer_name ?? ""}`;
      }),
    ];
    const active = result.versions.find((v) => v.status === "Active") ?? result.versions[0];
    return toolOk(
      withAgentScriptBranchState(
        { ok: true as const, ...result },
        active
          ? lifecycleVersionEvents({
              agentApiName: result.agent_api_name,
              botId: result.bot_id,
              botVersionId: active.bot_version_id,
              versionNumber: active.version_number,
              status: active.status,
              source: "lifecycle.list_versions",
            })
          : [],
      ),
      lines.join("\n"),
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "list_versions");
  }
}

// -------------------------------------------------------------------------------------------------
// Error classification
// -------------------------------------------------------------------------------------------------

export function classifyLifecycleError(
  err: unknown,
  agentApiName: string,
  callingAction: "publish" | "activate" | "deactivate" | "list_versions",
  agentFile?: string,
  featureProfile?: AgentFeatureProfile,
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);

  // 1. Consult the shared agent-API error map first. Same SFAP envelope as
  //    preview, so we get the typed cases (should-have-user-assigned,
  //    activation-rejected, sfap-404, etc.) for free.
  const phase: "publish" | "activate" | "deactivate" | undefined =
    callingAction === "publish" || callingAction === "activate" || callingAction === "deactivate"
      ? callingAction
      : undefined;
  if (phase) {
    const mapped = mapAgentApiError(
      // Pseudo-status: the lifecycle layer doesn't surface raw HTTP status
      // up to here, so we use 0 to skip status-only patterns. Patterns that
      // also match on body text (the ones we actually care about for
      // lifecycle) still fire.
      0,
      msg,
      {
        phase,
        surface: "lifecycle",
        agentApiName,
        agentFile,
        publishFeatureRisks: featureProfile?.publish_risks,
      },
    );
    if (mapped.matched) {
      return toolError(mapped.message, undefined, mapped.recover_via);
    }
  }

  // 2. Publish can fail with a restricted-picklist error when an action
  //    target URI names a Flow/Apex/etc. target that is not available in the
  //    org's generated function-definition registry. Surface it as an action
  //    target readiness issue instead of a raw SFAP validation blob.
  if (
    /Generative AI Function Definition ID|Invocation Target|bad value for restricted picklist field/i.test(
      msg,
    )
  ) {
    return toolError(
      msg,
      "Run agentscript_authoring inspect/check_targets for a per-target breakdown. Deploy or remove missing action targets, then publish again.",
      agentFile
        ? {
            tool: "agentscript_authoring",
            params: {
              verb: "inspect",
              mode: "check_targets",
              agent_file: agentFile,
              target_org: "<alias>",
            },
          }
        : undefined,
    );
  }

  // 3. SFAP routing failure on dev / non-Agentforce orgs — the upstream
  //    layer (lifecycle.ts / preview/client.ts) already throws sfap404Message
  //    when it detects the host fallback exhausted, so we typically don't
  //    re-enter this branch with a fresh 404. We keep it as a safety net for
  //    code paths that bubble a raw 404 string up here, and we delegate to
  //    the same shared message so the wording stays consistent.
  if (/ERROR_HTTP_404|HTTP 404|URL No Longer Exists/i.test(msg)) {
    return toolError(
      sfap404Message({
        phase:
          callingAction === "publish" || callingAction === "activate"
            ? callingAction
            : callingAction === "deactivate"
              ? "activate"
              : "publish",
        agentApiName,
      }),
    );
  }

  // 3. Agent-not-found path — only suggest list_versions if the LLM was already
  //    calling something else (activate/deactivate). For list_versions itself,
  //    a recover_via pointing back at list_versions is circular and useless.
  if (/not found/i.test(msg)) {
    if (callingAction === "list_versions") {
      return toolError(
        msg,
        'Verify the DeveloperName via `sf data query -q "SELECT DeveloperName FROM BotDefinition"`. There is no enumerate-all-agents tool yet.',
      );
    }
    return toolError(msg, "Use list_versions to confirm the DeveloperName.", {
      tool: LIFECYCLE_TOOL_NAME,
      params: { action: "list_versions", agent_api_name: agentApiName },
    });
  }
  return toolError(msg);
}

// -------------------------------------------------------------------------------------------------
// action = agent_user_status
// -------------------------------------------------------------------------------------------------

async function actionAgentUserStatus(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  const cfg = await readAgentConfigSlice(filePath);
  if (cfg.ok === false) {
    return toolError(
      `Cannot read .agent config from ${filePath}: ${cfg.reason_detail}`,
      cfg.reason === "parse_failed"
        ? "Run agentscript_authoring compile/check and fix severity-1 errors first."
        : undefined,
      cfg.reason === "parse_failed"
        ? {
            tool: "agentscript_authoring",
            params: { verb: "compile", mode: "check", agent_file: filePath },
          }
        : undefined,
    );
  }
  if (!cfg.agent_type) {
    return toolError(
      `'${filePath}' has no 'config.agent_type' — cannot determine wiring requirements.`,
      "Add 'agent_type: \"AgentforceEmployeeAgent\"' or 'AgentforceServiceAgent' to the config block.",
    );
  }
  try {
    const conn = await connFromAlias(input.target_org);
    const status = await checkAgentUserStatus(conn, {
      agent_type: cfg.agent_type,
      default_agent_user: cfg.default_agent_user,
    });
    return toolOk({ ok: true as const, ...status }, formatAgentUserStatusText(status));
  } catch (err) {
    return classifyLifecycleError(
      err,
      cfg.agent_name ?? path.basename(filePath, ".agent"),
      "list_versions", // closest existing classifier action; keeps recover_via shape sane
      filePath,
    );
  }
}

function formatAgentUserStatusText(s: AgentUserStatus): string {
  const icon = s.status === "ready" ? "\u2705" : s.status === "n/a" ? "\u26AA" : "\u26A0\uFE0F";
  const userLine = s.user
    ? `\n  user: ${s.user.Username} (Id ${s.user.Id}, ${s.user.IsActive ? "active" : "inactive"})`
    : "";
  const psLine = s.assigned_permission_sets?.length
    ? `\n  permission sets: ${s.assigned_permission_sets.join(", ")}`
    : "";
  return `${icon} agent_user_status: ${s.status} (${s.agent_type})\n  ${s.short_message}${userLine}${psLine}`;
}

// -------------------------------------------------------------------------------------------------
// action = diagnose_agent_user
// -------------------------------------------------------------------------------------------------

async function actionDiagnoseAgentUser(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  const cfg = await readAgentConfigSlice(filePath);
  if (cfg.ok === false) {
    return toolError(
      `Cannot read .agent config from ${filePath}: ${cfg.reason_detail}`,
      cfg.reason === "parse_failed"
        ? "Run agentscript_authoring compile/check and fix severity-1 errors first."
        : undefined,
      cfg.reason === "parse_failed"
        ? {
            tool: "agentscript_authoring",
            params: { verb: "compile", mode: "check", agent_file: filePath },
          }
        : undefined,
    );
  }
  if (!cfg.agent_type) {
    return toolError(
      `'${filePath}' has no 'config.agent_type'.`,
      "Add 'agent_type: \"AgentforceEmployeeAgent\"' or 'AgentforceServiceAgent'.",
    );
  }

  // Pull every action with a target so the apex_class_access check has
  // the .agent's full apex:// surface to verify against the user's PSs.
  const inspect = await inspectFile(filePath);
  const actions = inspect.ok ? (inspect.components?.actions ?? []) : [];

  try {
    const conn = await connFromAlias(input.target_org);
    const report = await runDiagnose(conn, {
      agent_type: cfg.agent_type,
      default_agent_user: cfg.default_agent_user,
      actions,
      agent_file: filePath,
      agent_api_name: cfg.agent_name,
    });
    return toolOk({ ok: true as const, ...report }, formatDiagnoseReportText(report));
  } catch (err) {
    return classifyLifecycleError(
      err,
      cfg.agent_name ?? path.basename(filePath, ".agent"),
      "list_versions",
      filePath,
    );
  }
}

function formatDiagnoseReportText(r: DiagnoseReport): string {
  const headerIcon = r.ok ? "\u2705" : "\u26A0\uFE0F";
  const lines: string[] = [];
  lines.push(
    `${headerIcon} diagnose_agent_user: ${r.ok ? "ready" : "not_ready"} (${r.agent_type} Agent)`,
  );
  if (r.default_agent_user) {
    lines.push(`  default_agent_user: ${r.default_agent_user}`);
  }
  if (r.found_licenses?.length) {
    lines.push(`  licenses: ${r.found_licenses.join(", ")}`);
  }
  lines.push("");
  lines.push("Checks:");
  for (const c of r.checks) {
    const icon = checkIcon(c.status);
    lines.push(`  ${icon} ${c.id}: ${c.status}`);
    lines.push(`     ${c.detail}`);
    if (c.fix_hint) lines.push(`     \u2192 ${c.fix_hint}`);
  }
  if (r.apex_actions && r.apex_actions.length > 0) {
    lines.push("");
    lines.push("Apex action targets:");
    for (const a of r.apex_actions) {
      const icon = a.status === "ok" ? "\u2705" : "\u274C";
      const granted = a.granted_via ? ` (via ${a.granted_via})` : "";
      lines.push(`  ${icon} ${a.name} \u2192 ${a.apex_class}${granted}`);
    }
  }
  if (r.candidate_einstein_agent_users?.length) {
    lines.push("");
    lines.push("Candidate Einstein Agent Users in this org:");
    for (const u of r.candidate_einstein_agent_users) {
      lines.push(`  \u2022 ${u.Username} (${u.IsActive ? "active" : "inactive"}, Id ${u.Id})`);
    }
  }
  return lines.join("\n");
}

function checkIcon(status: DiagnoseReport["checks"][number]["status"]): string {
  switch (status) {
    case "ok":
      return "\u2705";
    case "missing":
      return "\u274C";
    case "unknown":
      return "\u2754";
    case "skipped":
      return "\u23ED\uFE0F";
    case "n/a":
      return "\u26AA";
  }
}

// -------------------------------------------------------------------------------------------------
// action = provision_agent_user
// -------------------------------------------------------------------------------------------------

async function actionProvisionAgentUser(
  ctx: ExtensionContext,
  input: ParamsAny,
  stream: (msg: string) => void,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  const cfg = await readAgentConfigSlice(filePath);
  if (cfg.ok === false) {
    return toolError(
      `Cannot read .agent config from ${filePath}: ${cfg.reason_detail}`,
      cfg.reason === "parse_failed"
        ? "Run agentscript_authoring compile/check and fix severity-1 errors first."
        : undefined,
      cfg.reason === "parse_failed"
        ? {
            tool: "agentscript_authoring",
            params: { verb: "compile", mode: "check", agent_file: filePath },
          }
        : undefined,
    );
  }
  if (!cfg.agent_type) {
    return toolError(
      `'${filePath}' has no 'config.agent_type'.`,
      "Add 'agent_type: \"AgentforceServiceAgent\"' (or Employee).",
    );
  }
  if (cfg.agent_type !== "AgentforceServiceAgent") {
    return toolOk(
      {
        ok: true as const,
        agent_type: cfg.agent_type,
        was_dry_run: input.dry_run !== false,
        steps: [],
      },
      `\u26AA provision_agent_user: n/a (${cfg.agent_type})\n  Only Service Agents need user provisioning. Employee Agents run as the logged-in user.`,
    );
  }

  const agentApiName = cfg.agent_name ?? path.basename(filePath, ".agent");
  const inspect = await inspectFile(filePath);
  const actions = inspect.ok ? (inspect.components?.actions ?? []) : [];

  const dryRun = input.dry_run !== false;
  stream(
    dryRun
      ? "Provisioning (dry-run): gathering plan; no org mutations\u2026"
      : "Provisioning (live): executing org mutations idempotently\u2026",
  );

  try {
    const conn = await connFromAlias(input.target_org);
    const report = await runProvision(conn, {
      agent_type: cfg.agent_type,
      default_agent_user: cfg.default_agent_user,
      actions,
      agent_file: filePath,
      agent_api_name: agentApiName,
      dry_run: dryRun,
      ...(input.username_override ? { username_override: input.username_override } : {}),
    });
    return toolOk(
      { ok: true as const, ...report },
      formatProvisionReportText(report, filePath, input.target_org),
    );
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "list_versions", filePath);
  }
}

function formatProvisionReportText(
  r: ProvisionReport,
  agentFile: string,
  targetOrg: string | undefined,
): string {
  const headerIcon = r.was_dry_run ? "\u2139\uFE0F" : r.ok ? "\u2705" : "\u274C";
  const mode = r.was_dry_run ? "dry-run" : r.ok ? "executed" : "failed";
  const lines: string[] = [];
  lines.push(`${headerIcon} provision_agent_user: ${mode} (${r.agent_type} Agent)`);
  lines.push("");
  lines.push("Steps:");
  for (const step of r.steps) {
    lines.push(`  ${stepIcon(step)} ${step.id}: ${step.action}`);
    lines.push(`     ${step.detail}`);
    if (step.error) lines.push(`     error: ${step.error}`);
  }
  if (r.preview_custom_ps_xml) {
    lines.push("");
    lines.push(
      r.was_dry_run ? "Custom PS that would be deployed (preview):" : "Custom PS deployed:",
    );
    for (const xmlLine of r.preview_custom_ps_xml.split("\n")) {
      lines.push(`    ${xmlLine}`);
    }
  }
  if (r.was_dry_run && r.steps.some((s) => s.action === "would_execute")) {
    const orgFlag = targetOrg ? ` target_org='${targetOrg}'` : "";
    lines.push("");
    lines.push(
      `\u2192 To execute: agentscript_lifecycle action='provision_agent_user' agent_file='${agentFile}'${orgFlag} dry_run=false`,
    );
  }
  return lines.join("\n");
}

function stepIcon(step: ProvisionStep): string {
  switch (step.action) {
    case "executed":
      return "\u2705";
    case "skipped":
      return "\u23ED\uFE0F";
    case "would_execute":
      return "\u2139\uFE0F";
    case "failed":
      return "\u274C";
  }
}
