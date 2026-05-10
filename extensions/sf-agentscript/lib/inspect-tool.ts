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

export const INSPECT_TOOL_NAME = "agentscript_inspect";

// Single Type.Object: emits root `type:"object"` with non-empty `properties`.
// OpenAI strict tool-call validators reject anyOf-at-root (which the previous
// Type.Union shape produced). Per-action required-field checks are enforced
// inside execute().
const Params = Type.Object({
  action: Type.Optional(
    Type.Union(
      [Type.Literal("structure"), Type.Literal("find_references"), Type.Literal("definition")],
      {
        default: "structure",
        description:
          "structure (default): navigable component graph + line numbers. find_references: every usage of an `@<ns>.<prop>` symbol including the declaration. definition: where a symbol is declared.",
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
});

interface ParamsAny {
  action?: "structure" | "find_references" | "definition";
  path: string;
  symbol?: string;
}

export function registerInspectTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: INSPECT_TOOL_NAME,
    label: "Agent Script — inspect",
    description:
      "Multi-action structural query on a `.agent` file. action='structure' (default) returns a navigable component graph with line numbers and `@`-references per topic. action='find_references' returns every usage of an `@<ns>.<prop>` symbol including the declaration site. action='definition' returns the line where the symbol is declared. All local, ~10ms.",
    promptSnippet:
      "Query a .agent file's structure, references, or definitions. No re-read needed.",
    promptGuidelines: [
      "Use action='structure' (or omit action) BEFORE re-reading a `.agent` file — returns ~200 tokens vs ~3000 for a full read.",
      "Use action='find_references' before mutating a symbol so you know the blast radius. Returns the declaration site (is_declaration=true) plus every usage with line + character + a context snippet.",
      "Use action='definition' to jump from a usage to its declaration. Returns line + character + file. Cheaper than find_references when you only need the source of truth.",
      "When 'structure' returns has_parse_errors=true, run agentscript_compile first — the structural surface may be incomplete on broken files.",
      "Symbol format is always `@<namespace>.<property>` (e.g. '@actions.lookup'). Supported namespaces: topic, subagent, actions, variables.",
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
    `Stats: ${stats.topics ?? 0} topics · ${stats.subagents ?? 0} subagents · ` +
      `${stats.variables ?? 0} variables · ${stats.actions ?? 0} actions`,
  ];
  if (result.has_parse_errors) {
    lines.push(
      `⚠️ File has ${result.parse_error_count ?? 1} severity-1 parse error(s) — ` +
        `run agentscript_compile first; the structural surface may be incomplete.`,
    );
  }
  return lines.join("\n");
}
