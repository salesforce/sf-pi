/* SPDX-License-Identifier: Apache-2.0 */
/** Public agentscript_lifecycle registration and dispatch. */
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderLifecycleCall, renderLifecycleResult } from "./render/lifecycle.ts";
import { createTimingCollector, withTimings } from "./timings.ts";
import { toolError } from "./tool-types.ts";
import {
  actionPublish,
  actionActivate,
  actionDeactivate,
  actionListVersions,
} from "./lifecycle/actions/release.ts";
import {
  actionAgentUserStatus,
  actionDiagnoseAgentUser,
  actionProvisionAgentUser,
} from "./lifecycle/actions/agent-user.ts";

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
        "publish: ship a .agent file as an inactive new agent or version. activate / deactivate: toggle a BotVersion's Status (activation is release-eval gated and idempotent). list_versions: return every BotVersion on the agent. agent_user_status: cheap ready/not_ready/n/a preflight on the agent's user wiring. diagnose_agent_user: full read-only checklist (license, user, system PS, per-apex-class access). provision_agent_user: idempotently bring the org up to spec (creates user, assigns system PS, deploys + assigns custom PS for apex actions). Defaults to dry_run=true; pass dry_run=false to mutate.",
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
  release_spec_path: Type.Optional(
    Type.String({
      description:
        "Optional for action='activate'. Designated release eval spec path; defaults to tests/agentforce/<AgentApiName>.eval.json when present.",
    }),
  ),
  acknowledge_untested_activation: Type.Optional(
    Type.Boolean({
      description:
        "For action='activate'. Request the Guardrail-mediated emergency path when exact-version release eval evidence is missing or failed. This intent flag is not approval.",
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
  acknowledge_quality_risk: Type.Optional(
    Type.Boolean({
      description:
        "For action='publish'. Approve the newly reported High quality rule IDs (or quality-analysis-failed) for this bundle and current session. Default false.",
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
  release_spec_path?: string;
  acknowledge_untested_activation?: boolean;
  version?: number;
  dry_run?: boolean;
  acknowledge_quality_risk?: boolean;
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
      "Multi-action Agent Script lifecycle: publish an inactive version, activate only with exact-version release eval evidence, deactivate/list versions, and diagnose or provision Service Agent users.",
    renderCall: renderLifecycleCall,
    renderResult: renderLifecycleResult,
    promptSnippet:
      "Publish inactive Agent Script versions and manage eval-gated activation lifecycle.",
    promptGuidelines: [
      "Agent Script publication always creates an inactive version; run agentscript_eval action='run_release' before separate activation.",
      "Activation without matching exact-version evidence requires acknowledge_untested_activation=true and a distinct Guardrail approval; the intent flag is never self-approval.",
      "Use the installed Agent Script guide path declared in <sf_engineering_constitution> for quality overrides, version management, and Service Agent user provisioning.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const timings = createTimingCollector();
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
      if (reqOk.ok === false) {
        return withTimings(toolError("INVALID_PARAMS", reqOk.error), timings, { appendLine: true });
      }
      let result;
      switch (p.action) {
        case "publish":
          result = await actionPublish(ctx, p, stream, timings, _signal);
          break;
        case "activate":
          result = await timings.time("lifecycle.activate", () => actionActivate(ctx, p, _signal));
          break;
        case "deactivate":
          result = await timings.time("lifecycle.deactivate", () => actionDeactivate(p, _signal));
          break;
        case "list_versions":
          result = await timings.time("lifecycle.list_versions", () =>
            actionListVersions(p, _signal),
          );
          break;
        case "agent_user_status":
          result = await timings.time("lifecycle.agent_user_status", () =>
            actionAgentUserStatus(ctx, p),
          );
          break;
        case "diagnose_agent_user":
          result = await timings.time("lifecycle.diagnose_agent_user", () =>
            actionDiagnoseAgentUser(ctx, p),
          );
          break;
        case "provision_agent_user":
          result = await timings.time("lifecycle.provision_agent_user", () =>
            actionProvisionAgentUser(ctx, p, stream, _signal),
          );
          break;
      }
      return withTimings(result, timings, { appendLine: true });
    },
  });
}
