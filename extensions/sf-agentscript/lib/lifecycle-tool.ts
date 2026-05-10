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
import { connFromAlias } from "./connection.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import { activateVersion, deactivateVersion, listVersions, publishAgent } from "./lifecycle.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "./tool-types.ts";

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
    ],
    {
      description:
        "publish: ship a .agent file as a new agent or new version. activate / deactivate: toggle a BotVersion's Status (idempotent). list_versions: return every BotVersion on the agent.",
    },
  ),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias / username." })),
  agent_file: Type.Optional(
    Type.String({
      description: "Required for action='publish'. Path to the `.agent` file.",
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
});

interface ParamsAny {
  action: "publish" | "activate" | "deactivate" | "list_versions";
  target_org?: string;
  agent_file?: string;
  agent_api_name?: string;
  activate?: boolean;
  version?: number;
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
  }
}

export function registerLifecycleTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: LIFECYCLE_TOOL_NAME,
    label: "Agent Script lifecycle",
    description:
      "Multi-action publish lifecycle: publish a `.agent` (creates new agent or new version), activate / deactivate a specific version, or list every version on an agent in the org. Local pre-flight before server publish; SOQL-backed list_versions; idempotent activate.",
    promptSnippet: "Ship a .agent file to the org and toggle version activation.",
    promptGuidelines: [
      "action='publish' — pass agent_file (the .agent path). Auto-detects new-agent vs new-version. Set activate=true to chain publish+activate in one call.",
      "action='activate' / 'deactivate' — pass agent_api_name; omit version for the latest. Idempotent: a no-op when already in the requested state.",
      "action='list_versions' — returns every BotVersion (id, number, status, dates). Use to discover which version is Active before previewing or running eval.",
      "Errors carry recover_via where applicable (e.g. agent not found → list_versions hint).",
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
          return await actionActivate(p);
        case "deactivate":
          return await actionDeactivate(p);
        case "list_versions":
          return await actionListVersions(p);
      }
    },
  });
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

  const agentApiName = input.agent_api_name ?? path.basename(filePath, ".agent");
  // The bundle directory contains both the `.agent` file and the
  // `.bundle-meta.xml` file. SDR's ComponentSet.fromSource(bundleDir)
  // walks both and zips them up for the deploy().
  const bundleDir = path.dirname(filePath);

  try {
    const conn = await connFromAlias(input.target_org);
    const { conn: agentApiConn } = await connForAgentApi(input.target_org);
    const result = await publishAgent({
      conn,
      agentApiConn,
      agentSource: source,
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
    return toolOk(
      {
        ok: true as const,
        agent_api_name: result.developer_name,
        bot_id: result.bot_id,
        bot_version_id: result.bot_version_id,
        version_developer_name: result.version_developer_name,
        was_new_agent: result.was_new_agent,
        activated: result.activated,
        authoring_bundle: result.authoring_bundle,
      },
      [
        `📦 Published ${result.developer_name}`,
        result.was_new_agent ? "  • created new agent" : "  • new version of existing agent",
        `  • bot_version_id: ${result.bot_version_id}`,
        bundleLine,
        result.activated ? "  • activated ✓" : "  • not activated (set activate=true to chain)",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Local compile rejected/i.test(msg)) {
      return toolError(msg, undefined, {
        tool: "agentscript_compile",
        params: { path: filePath },
      });
    }
    return toolError(msg);
  }
}

// -------------------------------------------------------------------------------------------------
// action = activate / deactivate
// -------------------------------------------------------------------------------------------------

async function actionActivate(input: ParamsAny): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // checkRequired guarantees agent_api_name is set for action='activate'.
  const agentApiName = input.agent_api_name as string;
  try {
    const conn = await connFromAlias(input.target_org);
    const row = await activateVersion({
      conn,
      agentApiName,
      version: input.version,
    });
    return toolOk(
      {
        ok: true as const,
        agent_api_name: agentApiName,
        bot_version_id: row.Id,
        version_number: row.VersionNumber,
        status: row.Status,
      },
      `🟢 ${agentApiName} v${row.VersionNumber} activated`,
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
      {
        ok: true as const,
        agent_api_name: agentApiName,
        bot_version_id: row.Id,
        version_number: row.VersionNumber,
        status: row.Status,
      },
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
    return toolOk({ ok: true as const, ...result }, lines.join("\n"));
  } catch (err) {
    return classifyLifecycleError(err, agentApiName, "list_versions");
  }
}

// -------------------------------------------------------------------------------------------------
// Error classification
// -------------------------------------------------------------------------------------------------

function classifyLifecycleError(
  err: unknown,
  agentApiName: string,
  callingAction: "publish" | "activate" | "deactivate" | "list_versions",
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);

  // SFAP routing failure on dev / non-Agentforce orgs — give a friendlier hint.
  if (/ERROR_HTTP_404|HTTP 404|URL No Longer Exists/i.test(msg)) {
    return toolError(
      `${msg.split("\n")[0]} — the org's Einstein AI Agent SFAP routes are not reachable.`,
      "This typically means the org isn't Agentforce-enabled (e.g. a basic dev edition). Try a sandbox or production org with Agentforce enabled.",
    );
  }

  // Agent-not-found path — only suggest list_versions if the LLM was already
  // calling something else (activate/deactivate). For list_versions itself,
  // a recover_via pointing back at list_versions is circular and useless.
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
