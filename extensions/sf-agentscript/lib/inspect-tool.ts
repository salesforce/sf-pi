/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_inspect — multi-action structural query surface.
 *
 * Actions:
 *   structure        Default. Navigable graph of components + line numbers.
 *   find_references  Every `@<ns>.<prop>` usage of a symbol (+ declaration).
 *   definition       Where the symbol is declared (file + line).
 *
 * All actions run locally on the vendored SDK — ~10ms, no network.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { findDefinition, findReferences, inspectFile } from "./inspect.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "./tool-types.ts";
import { renderInspectCall, renderInspectResult } from "./render/inspect.ts";
import { connForAgentApi } from "./agent-api-auth.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import { checkActionTargets } from "./preflight.ts";

export const INSPECT_TOOL_NAME = "agentscript_inspect";

// Single Type.Object: emits root `type:"object"` with non-empty `properties`.
// OpenAI strict tool-call validators reject anyOf-at-root (which the previous
// Type.Union shape produced). Per-action required-field checks are enforced
// inside execute().
const Params = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("structure"),
        Type.Literal("find_references"),
        Type.Literal("definition"),
        Type.Literal("check_targets"),
      ],
      {
        default: "structure",
        description:
          "structure (default): navigable component graph + line numbers. find_references: every usage of an `@<ns>.<prop>` symbol including the declaration. definition: where a symbol is declared. check_targets: pre-flight every `@actions.X` declaration's `target:` URI (flow://X / apex://X) against the org via Tooling API.",
      },
    ),
  ),
  path: Type.String({
    description: "Absolute or workspace-relative path to a `.agent` file.",
  }),
  symbol: Type.Optional(
    Type.String({
      description:
        "Required for find_references and definition. Format: `@<namespace>.<property>` — e.g. '@topic.billing', '@actions.lookup_balance'.",
    }),
  ),
  target_org: Type.Optional(
    Type.String({
      description: "Required for action='check_targets'. sf CLI alias / username.",
    }),
  ),
});

interface ParamsAny {
  action?: "structure" | "find_references" | "definition" | "check_targets";
  path: string;
  symbol?: string;
  target_org?: string;
}

export function registerInspectTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: INSPECT_TOOL_NAME,
    label: "Agent Script — inspect",
    description:
      "Multi-action structural query on a `.agent` file. action='structure' (default) returns a navigable component graph with line numbers and `@`-references per topic. action='find_references' returns every usage of an `@<ns>.<prop>` symbol including the declaration site. action='definition' returns the line where the symbol is declared. All local, ~10ms.",
    renderCall: renderInspectCall,
    renderResult: renderInspectResult,
    promptSnippet:
      "Query a .agent file's structure, references, or definitions. No re-read needed.",
    promptGuidelines: [
      "Use action='structure' (or omit action) BEFORE re-reading a `.agent` file — returns ~200 tokens vs ~3000 for a full read.",
      "Use action='find_references' before mutating a symbol so you know the blast radius. Returns the declaration site (is_declaration=true) plus every usage with line + character + a context snippet.",
      "Use action='definition' to jump from a usage to its declaration. Returns line + character + file. Cheaper than find_references when you only need the source of truth.",
      "Use action='check_targets' BEFORE publishing to confirm every `target:` URI on action declarations resolves in the org. Catches missing flows / apex classes BEFORE a publish + activate round-trip would fail at preview-start runtime. Requires target_org.",
      "When 'structure' returns has_parse_errors=true, run agentscript_compile first — the structural surface may be incomplete on broken files.",
      "Symbol format is always `@<namespace>.<property>` (e.g. '@actions.lookup'). Supported namespaces: topic, subagent, actions, variables.",
      "`variable_refs` / `subagent_refs` / `action_refs` reflect real expression references (`transition to @topic.X`, `{!@variables.X}` interpolations). Plain text mentions inside `|`-templates are literal text, not refs, and won't appear here.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const p = params as ParamsAny;
      const resolved = safeResolveToolPath(p.path, ctx.cwd);
      if ("absPath" in resolved === false) return resolved;
      const filePath = resolved.absPath;
      if (!isAgentScriptFile(filePath)) {
        return toolError(
          `Not an Agent Script file: ${filePath}`,
          "Pass a path ending in `.agent`.",
        );
      }
      const action = p.action ?? "structure";
      if (action === "find_references" || action === "definition") {
        if (!p.symbol) {
          return toolError(
            "INVALID_PARAMS",
            `\`symbol\` is required for action='${action}'. Format: '@<namespace>.<property>'.`,
          );
        }
      } else if (action === "check_targets") {
        if (p.symbol) {
          return toolError("INVALID_PARAMS", "`symbol` is not valid for action='check_targets'.");
        }
      } else if (p.symbol) {
        return toolError(
          "INVALID_PARAMS",
          "`symbol` is only valid for action='find_references' or action='definition'.",
        );
      }
      switch (action) {
        case "structure":
          return await actionStructure(filePath);
        case "find_references":
          return await actionFindReferences(filePath, p.symbol as string);
        case "definition":
          return await actionDefinition(filePath, p.symbol as string);
        case "check_targets":
          return await actionCheckTargets(filePath, p.target_org);
      }
    },
  });
}

// -------------------------------------------------------------------------------------------------
// action = structure
// -------------------------------------------------------------------------------------------------

async function actionStructure(filePath: string): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const result = await inspectFile(filePath);
  if (!result.ok) {
    if (result.reason === "sdk_unavailable") {
      return toolError(
        `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
        "Run /sf-agentscript doctor to diagnose the vendored bundle.",
        { tool: "sf-agentscript", params: { action: "doctor" } },
      );
    }
    return toolError(`Inspect failed: ${result.reason ?? "unknown"}`, result.reason_detail);
  }

  const summaryText = renderStructureSummary(filePath, result);
  return toolOk(
    {
      ok: true as const,
      action: "structure" as const,
      path: filePath,
      dialect: result.dialect,
      components: result.components,
      stats: result.stats,
      has_parse_errors: result.has_parse_errors ?? false,
      parse_error_count: result.parse_error_count ?? 0,
    },
    summaryText,
  );
}

// -------------------------------------------------------------------------------------------------
// action = find_references
// -------------------------------------------------------------------------------------------------

async function actionFindReferences(
  filePath: string,
  symbol: string,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const result = await findReferences(filePath, symbol);
  if (!result.ok) {
    if (result.reason === "sdk_unavailable") {
      return toolError(
        `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
        "Run /sf-agentscript doctor to diagnose the vendored bundle.",
        { tool: "sf-agentscript", params: { action: "doctor" } },
      );
    }
    return toolError(`find_references failed: ${result.reason ?? "unknown"}`, result.reason_detail);
  }
  const refs = result.references ?? [];
  const declCount = refs.filter((r) => r.is_declaration).length;
  const usageCount = refs.length - declCount;
  const lines = [
    `🔎 ${symbol} — ${refs.length} hit(s) (${declCount} declaration, ${usageCount} usage${usageCount === 1 ? "" : "s"})`,
    ...refs.slice(0, 12).map((r) => {
      const tag = r.is_declaration ? "decl" : "use ";
      return `  ${tag} L${r.line}:${r.character} · ${r.context}`;
    }),
    refs.length > 12 ? `  …and ${refs.length - 12} more in details.references` : "",
  ].filter(Boolean);
  return toolOk(
    {
      ok: true as const,
      action: "find_references" as const,
      path: filePath,
      symbol,
      references: refs,
      total: result.total ?? refs.length,
    },
    lines.join("\n"),
  );
}

// -------------------------------------------------------------------------------------------------
// action = definition
// -------------------------------------------------------------------------------------------------

async function actionDefinition(
  filePath: string,
  symbol: string,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const result = await findDefinition(filePath, symbol);
  if (!result.ok) {
    if (result.reason === "sdk_unavailable") {
      return toolError(
        `Agent Script SDK unavailable: ${result.reason_detail ?? "unknown reason"}.`,
        "Run /sf-agentscript doctor to diagnose the vendored bundle.",
        { tool: "sf-agentscript", params: { action: "doctor" } },
      );
    }
    if (result.reason === "not_found") {
      return toolError(
        `${symbol} is not declared in ${filePath}.`,
        "Use find_references to see if it's referenced anywhere.",
        {
          tool: INSPECT_TOOL_NAME,
          params: { action: "find_references", path: filePath, symbol },
        },
      );
    }
    return toolError(`definition failed: ${result.reason ?? "unknown"}`, result.reason_detail);
  }
  return toolOk(
    {
      ok: true as const,
      action: "definition" as const,
      symbol,
      file: result.file,
      line: result.line,
      character: result.character,
    },
    `📍 ${symbol} declared at ${result.file}:${result.line}:${result.character ?? 0}`,
  );
}

// -------------------------------------------------------------------------------------------------
// action = check_targets
// -------------------------------------------------------------------------------------------------

async function actionCheckTargets(
  filePath: string,
  targetOrg: string | undefined,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  if (!targetOrg) {
    return toolError(
      "action='check_targets' requires target_org.",
      "Pass target_org=<sf alias> so we can query the org via Tooling API.",
    );
  }
  const inspect = await inspectFile(filePath);
  if (!inspect.ok) {
    return toolError(`Inspect failed: ${inspect.reason ?? "unknown"}`, inspect.reason_detail);
  }
  const actions = inspect.components?.actions ?? [];
  if (actions.length === 0) {
    return toolOk(
      {
        ok: true as const,
        action: "check_targets" as const,
        path: filePath,
        targets: [],
        total: 0,
        resolved: 0,
        missing: 0,
        unverifiable: 0,
      },
      `✓ ${filePath} declares no actions — nothing to check.`,
    );
  }
  let conn;
  try {
    // Tooling queries don't need the named-user JWT (Connection alone
    // works), but we use connForAgentApi to mirror the conn lifetime that
    // publish uses; falls back to the regular alias-based connection.
    conn = await connForAgentApi(targetOrg).then((c) => c.conn);
  } catch {
    conn = await connFromAlias(targetOrg);
  }
  const result = await checkActionTargets(conn, actions);
  const summaryLines = [
    result.ok
      ? `✓ All ${result.total} action target(s) resolved in org`
      : `⚠ ${result.missing}/${result.total} action target(s) missing in org`,
  ];
  for (const t of result.targets.slice(0, 8)) {
    const flag = t.status === "ok" ? "✓" : t.status === "missing" ? "✗" : "?";
    const detail = t.status === "ok" ? "" : ` — ${t.detail ?? "not verified"}`;
    summaryLines.push(`  ${flag} ${t.name} → ${t.target}${detail}`);
  }
  if (result.targets.length > 8) {
    summaryLines.push(`  …and ${result.targets.length - 8} more in details.targets`);
  }
  return toolOk(
    {
      ok: result.ok,
      action: "check_targets" as const,
      path: filePath,
      total: result.total,
      resolved: result.resolved,
      missing: result.missing,
      unverifiable: result.unverifiable,
      targets: result.targets,
    },
    summaryLines.join("\n"),
  );
}

// -------------------------------------------------------------------------------------------------
// Rendering helpers
// -------------------------------------------------------------------------------------------------

function renderStructureSummary(
  filePath: string,
  result: {
    dialect?: { name: string; version?: string };
    stats?: Record<string, number>;
    has_parse_errors?: boolean;
    parse_error_count?: number;
  },
): string {
  const stats = result.stats ?? {};
  const dialect = result.dialect
    ? `${result.dialect.name}${result.dialect.version ? ` ${result.dialect.version}` : ""}`
    : "unknown";
  const lines = [
    `📋 Inspected ${filePath}`,
    `Dialect: ${dialect}`,
    `Stats: ${stats.start_agents ?? 0} start · ${stats.topics ?? 0} topics · ` +
      `${stats.subagents ?? 0} subagents · ${stats.variables ?? 0} variables · ` +
      `${stats.actions ?? 0} actions · ${stats.connections ?? 0} connections · ` +
      `${stats.modalities ?? 0} modalities`,
  ];
  if (result.has_parse_errors) {
    lines.push(
      `⚠️ File has ${result.parse_error_count ?? 1} severity-1 parse error(s) — ` +
        `run agentscript_compile first; the structural surface may be incomplete.`,
    );
  }
  return lines.join("\n");
}
