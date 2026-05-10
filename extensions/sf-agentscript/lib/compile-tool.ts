/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_compile — multi-action local-first compile / format.
 *
 * Actions:
 *   check (default)  Parse + lint + compile via the vendored SDK. Returns
 *                    diagnostics + apply_via-ready quick fixes.
 *   format           Run emit() on the parsed AST and write the canonical
 *                    formatting back to disk. Refuses to format files with
 *                    severity-1 parse errors.
 *
 * fallback="server" (check action only) — when the local SDK rejects
 * something the server accepts (typically dialect-version skew), retry via
 * /einstein/ai-agent/v1.1/authoring/scripts. Uses @salesforce/core Connection.
 */

import { readFile, writeFile } from "node:fs/promises";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "./agent-api-auth.ts";
import { checkAgentScriptFile } from "./diagnostics.ts";
import { isAgentScriptFile, resolveToolPath } from "./file-classify.ts";
import { loadAgentforceSDK } from "./sdk.ts";
import { serverCompile } from "./lifecycle.ts";
import { toolError, toolOk, type ToolError } from "./tool-types.ts";
import type { AgentScriptQuickFix } from "./types.ts";

export const COMPILE_TOOL_NAME = "agentscript_compile";

// Schema is a single Type.Object so the emitted JSON Schema has
// `type: "object"` at the root — OpenAI's strict tool validator rejects a
// root anyOf (which Type.Union of objects produces). Per-action required
// fields are enforced in execute() instead of at the schema layer.
const Params = Type.Object({
  action: Type.Optional(
    Type.Union([Type.Literal("check"), Type.Literal("format")], {
      default: "check",
      description:
        "check (default): parse + lint + compile via the vendored SDK. format: rewrite the file with canonical whitespace.",
    }),
  ),
  path: Type.String({
    description: "Absolute or workspace-relative path to a `.agent` file.",
  }),
  fallback: Type.Optional(
    Type.Union([Type.Literal("none"), Type.Literal("server")], {
      description:
        "Only used when action='check'. 'server' retries via /einstein/ai-agent/v1.1/authoring/scripts when local rejects. Requires target_org.",
    }),
  ),
  target_org: Type.Optional(
    Type.String({
      description: "Required when fallback='server'. sf CLI alias / username.",
    }),
  ),
});

interface ParamsAny {
  action?: "check" | "format";
  path: string;
  fallback?: "none" | "server";
  target_org?: string;
}

interface QuickFixView extends AgentScriptQuickFix {
  apply_via: {
    tool: "agentscript_mutate";
    params: {
      op: "apply_quick_fix";
      path: string;
      diagnostic_code: string;
      line: number;
      fix_index: number;
    };
  };
}

export function registerCompileTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: COMPILE_TOOL_NAME,
    label: "Agent Script — compile",
    description:
      "Local-first compile of a `.agent` file via the vendored Agentforce SDK. action='check' (default) returns diagnostics + apply_via-ready quick fixes; action='format' canonicalizes whitespace via emit() (refuses on parse errors). fallback='server' (check only) retries via the authoring/scripts endpoint when local rejects.",
    promptSnippet:
      "Parse + compile a .agent file locally; optionally retry server-side. Or canonicalize formatting.",
    promptGuidelines: [
      "action='check' (default) — local, ~10ms. Returns severity-1 errors and actionable severity-2 warnings. Each quick_fix carries `apply_via: agentscript_mutate apply_quick_fix` — prefer that path over the generic edit tool.",
      "action='format' — runs emit() and writes the canonical formatting back. Refuses if the file has severity-1 errors (would corrupt source).",
      "fallback='server' — only useful when the vendored SDK is behind on a dialect feature. Costs a network round-trip; pass target_org.",
      "When the SDK is unavailable, returns recover_via pointing at /sf-agentscript doctor.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const p = params as ParamsAny;
      if (!p.path) return toolError("INVALID_PARAMS", "`path` is required.");
      const filePath = resolveToolPath(p.path, ctx.cwd);
      if (!isAgentScriptFile(filePath)) {
        return toolError(
          `Not an Agent Script file: ${filePath}`,
          "Pass a path ending in `.agent`.",
        );
      }
      const action = p.action ?? "check";
      if (action === "format") {
        if (p.fallback || p.target_org) {
          return toolError(
            "INVALID_PARAMS",
            "`fallback` and `target_org` are only valid with action='check'.",
          );
        }
        return await actionFormat(filePath);
      }
      return await actionCheck(filePath, p);
    },
  });
}

// -------------------------------------------------------------------------------------------------
// action = check
// -------------------------------------------------------------------------------------------------

async function actionCheck(
  filePath: string,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const result = await checkAgentScriptFile(filePath);

  // Local-side error path.
  if (!result.ok) {
    const reason = result.unavailableReason ?? "unknown reason";
    switch (result.failureKind) {
      case "read_failed":
        return toolError(
          `Cannot read ${filePath}: ${reason}`,
          "Verify the path exists. Use the `find` or `ls` tool to confirm.",
        );
      case "compile_threw":
        return toolError(
          `Agent Script SDK threw during compile: ${reason}`,
          "This is most likely a vendored SDK bug. Run /sf-agentscript doctor.",
          { tool: "sf-agentscript", params: { action: "doctor" } },
        );
      case "sdk_unavailable":
      default:
        return toolError(
          `Agent Script SDK unavailable: ${reason}`,
          "Run /sf-agentscript doctor to diagnose the vendored bundle.",
          { tool: "sf-agentscript", params: { action: "doctor" } },
        );
    }
  }

  // Server fallback when local has severity-1 errors AND the caller asked for it.
  if (input.fallback === "server" && result.diagnostics.some((d) => d.severity === 1)) {
    if (!input.target_org) {
      return toolError(
        "fallback='server' requires target_org.",
        "Pass target_org=<alias> or set the active sf-pi target org.",
      );
    }
    try {
      const { conn } = await connForAgentApi(input.target_org);
      const source = await readFile(filePath, "utf8");
      const serverResult = await serverCompile(conn, source);
      if (serverResult.ok) {
        return toolOk(
          {
            ok: true as const,
            path: filePath,
            clean: true,
            diagnostic_count: 0,
            quick_fix_count: 0,
            dialect: result.dialect ?? null,
            compiled_via: "server" as const,
            fallback_reason:
              "Local compile reported severity-1 errors but the server accepted the source.",
            agent_json: serverResult.agentJson,
          },
          `✓ ${filePath} compiled clean via server (local rejected; dialect-version skew likely)`,
        );
      }
      // Server also rejected — fall through and report the local diagnostics.
    } catch {
      // fall through — server failed; we still have local diagnostics
    }
  }

  // Build apply_via on each quick fix.
  const fixesByKey = new Map<string, AgentScriptQuickFix[]>();
  for (const f of result.quickFixes) {
    const key = `${f.diagnosticLine}::${f.diagnosticCode ?? ""}`;
    const arr = fixesByKey.get(key);
    if (arr) arr.push(f);
    else fixesByKey.set(key, [f]);
  }
  const quickFixesView: QuickFixView[] = result.quickFixes.map((f) => {
    const key = `${f.diagnosticLine}::${f.diagnosticCode ?? ""}`;
    const arr = fixesByKey.get(key) ?? [f];
    const fixIndex = arr.indexOf(f);
    return {
      ...f,
      apply_via: {
        tool: "agentscript_mutate" as const,
        params: {
          op: "apply_quick_fix" as const,
          path: filePath,
          diagnostic_code: f.diagnosticCode ?? "",
          line: f.diagnosticLine + 1,
          fix_index: fixIndex,
        },
      },
    };
  });

  const summary = {
    ok: true as const,
    action: "check" as const,
    path: filePath,
    clean: result.diagnostics.length === 0,
    diagnostic_count: result.diagnostics.length,
    quick_fix_count: quickFixesView.length,
    dialect: result.dialect ?? null,
    compiled_via: "local" as const,
  };
  const summaryText =
    result.diagnostics.length === 0
      ? `✓ ${filePath} compiles clean (${result.dialect?.name ?? "unknown dialect"})`
      : `❌ ${filePath} — ${result.diagnostics.length} issue(s), ${quickFixesView.length} fix(es) ready`;

  return toolOk(
    {
      ...summary,
      diagnostics: result.diagnostics,
      quick_fixes: quickFixesView,
    },
    summaryText,
  );
}

// -------------------------------------------------------------------------------------------------
// action = format
// -------------------------------------------------------------------------------------------------

async function actionFormat(filePath: string): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return toolError(
      "Agent Script SDK unavailable.",
      "Run /sf-agentscript doctor to diagnose the vendored bundle.",
      { tool: "sf-agentscript", params: { action: "doctor" } },
    );
  }
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (err) {
    return toolError(
      `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let doc: { hasErrors: boolean; emit: () => string };
  try {
    doc = (sdk as unknown as { parse: (s: string) => typeof doc }).parse(source);
  } catch (err) {
    return toolError(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (doc.hasErrors) {
    return toolError(
      `Refusing to format ${filePath} — file has parse errors.`,
      "Run agentscript_compile to see them and fix first.",
      { tool: COMPILE_TOOL_NAME, params: { action: "check", path: filePath } },
    );
  }

  const formatted = doc.emit();
  if (formatted === source) {
    return toolOk(
      {
        ok: true as const,
        action: "format" as const,
        path: filePath,
        changed: false,
        bytes_changed: 0,
      },
      `✓ ${filePath} already canonically formatted`,
    );
  }
  await writeFile(filePath, formatted, "utf8");
  return toolOk(
    {
      ok: true as const,
      action: "format" as const,
      path: filePath,
      changed: true,
      bytes_changed: formatted.length - source.length,
    },
    `✨ ${filePath} formatted (Δ ${formatted.length - source.length} bytes)`,
  );
}
