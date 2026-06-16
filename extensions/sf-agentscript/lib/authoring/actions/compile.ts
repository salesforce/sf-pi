/* SPDX-License-Identifier: Apache-2.0 */
/** Compile/check + compile/format actions for agentscript_authoring. */

import { readFile, writeFile } from "node:fs/promises";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "../../agent-api-auth.ts";
import { getAgentScriptAnalysis, invalidateAgentScriptAnalysis } from "../../analysis-snapshot.ts";
import { isAgentScriptFile } from "../../file-classify.ts";
import { serverCompile } from "../../lifecycle.ts";
import { loadAgentforceSDK } from "../../sdk.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "../../tool-types.ts";
import type { AgentScriptQuickFix } from "../../types.ts";
import {
  agentFileEvent,
  resolveCurrentAgentFile,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "../../branch-state.ts";
import type { AuthoringParams } from "../params.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TimingCollector } from "../../timings.ts";

interface QuickFixView extends AgentScriptQuickFix {
  apply_via: {
    tool: "agentscript_authoring";
    params: {
      verb: "mutate";
      mode: "apply_quick_fix";
      agent_file: string;
      diagnostic_code: string;
      line: number;
      fix_index: number;
    };
  };
}

export async function runCompileAction(
  ctx: ExtensionContext,
  input: AuthoringParams,
  timings?: TimingCollector,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = await resolveCurrentAgentFile(ctx, input.agent_file, (value) =>
    safeResolveToolPath(value, ctx.cwd),
  );
  if ("agentFile" in resolved === false) return resolved;
  const agentFile = resolved.agentFile;
  if (!isAgentScriptFile(agentFile)) {
    return toolError(`Not an Agent Script file: ${agentFile}`, "Pass a path ending in `.agent`.");
  }

  const mode = input.mode ?? "check";
  if (mode === "format") {
    if (input.fallback || input.target_org) {
      return toolError(
        "INVALID_PARAMS",
        "`fallback` and `target_org` are only valid with verb='compile' mode='check'.",
      );
    }
    return actionFormat(agentFile);
  }
  if (mode !== "check") {
    return toolError("INVALID_PARAMS", "verb='compile' supports mode='check' or mode='format'.");
  }
  return actionCheck(agentFile, input, timings);
}

async function actionCheck(
  agentFile: string,
  input: AuthoringParams,
  timings?: TimingCollector,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const result = timings
    ? await timings.time("local_compile", async () =>
        (await getAgentScriptAnalysis(agentFile)).getCompile(),
      )
    : await (await getAgentScriptAnalysis(agentFile)).getCompile();

  if (!result.ok) {
    const reason = result.unavailableReason ?? "unknown reason";
    switch (result.failureKind) {
      case "read_failed":
        return toolError(
          `Cannot read ${agentFile}: ${reason}`,
          "Verify the path exists. Use the `find` or `ls` tool to confirm.",
        );
      case "compile_threw":
        return toolError(
          `Agent Script SDK threw during compile: ${reason}`,
          "This is most likely an official SDK package bug. Run /sf-agentscript doctor.",
          { tool: "sf-agentscript", params: { action: "doctor" } },
        );
      case "sdk_unavailable":
      default:
        return toolError(
          `Agent Script SDK unavailable: ${reason}`,
          "Run /sf-agentscript doctor to diagnose the official SDK package.",
          { tool: "sf-agentscript", params: { action: "doctor" } },
        );
    }
  }

  if (input.fallback === "server" && result.diagnostics.some((d) => d.severity === 1)) {
    if (!input.target_org) {
      return toolError(
        "fallback='server' requires target_org.",
        "Pass target_org=<alias> or set the active sf-pi target org.",
      );
    }
    try {
      const authPhase = timings?.phase("agent_api_auth");
      const auth = await connForAgentApi(input.target_org);
      authPhase?.end({ cache: auth.cache });
      const { conn } = auth;
      const source = await readFile(agentFile, "utf8");
      const serverResult = timings
        ? await timings.time("server_compile", () => serverCompile(conn, source))
        : await serverCompile(conn, source);
      if (serverResult.ok) {
        const details = withAgentScriptBranchState(
          {
            ok: true as const,
            action: "compile.check" as const,
            agent_file: agentFile,
            path: agentFile,
            clean: true,
            diagnostic_count: 0,
            quick_fix_count: 0,
            dialect: result.dialect ?? null,
            compiled_via: "server" as const,
            fallback_reason:
              "Local compile reported severity-1 errors but the server accepted the source.",
            agent_json: serverResult.agentJson,
          },
          compileEvents(agentFile, true, 0, 0, "compile.check"),
        );
        return toolOk(
          details,
          `✓ ${agentFile} compiled clean via server (local rejected; dialect-version skew likely)`,
        );
      }
    } catch {
      // Fall through and report local diagnostics.
    }
  }

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
        tool: "agentscript_authoring" as const,
        params: {
          verb: "mutate" as const,
          mode: "apply_quick_fix" as const,
          agent_file: agentFile,
          diagnostic_code: f.diagnosticCode ?? "",
          line: f.diagnosticLine + 1,
          fix_index: fixIndex,
        },
      },
    };
  });

  const details = withAgentScriptBranchState(
    {
      ok: true as const,
      action: "compile.check" as const,
      agent_file: agentFile,
      path: agentFile,
      clean: result.diagnostics.length === 0,
      diagnostic_count: result.diagnostics.length,
      quick_fix_count: quickFixesView.length,
      dialect: result.dialect ?? null,
      compiled_via: "local" as const,
      diagnostics: result.diagnostics,
      quick_fixes: quickFixesView,
    },
    compileEvents(
      agentFile,
      result.diagnostics.length === 0,
      result.diagnostics.length,
      quickFixesView.length,
      "compile.check",
    ),
  );

  return toolOk(
    details,
    renderCheckSummary(agentFile, result.diagnostics, quickFixesView.length, result.dialect?.name),
  );
}

async function actionFormat(agentFile: string): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  return withFileMutationQueue(agentFile, () => actionFormatQueued(agentFile));
}

async function actionFormatQueued(agentFile: string): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const sdk = await loadAgentforceSDK();
  if (!sdk) {
    return toolError(
      "Agent Script SDK unavailable.",
      "Run /sf-agentscript doctor to diagnose the official SDK package.",
      { tool: "sf-agentscript", params: { action: "doctor" } },
    );
  }
  let source: string;
  try {
    source = await readFile(agentFile, "utf8");
  } catch (err) {
    return toolError(
      `Cannot read ${agentFile}: ${err instanceof Error ? err.message : String(err)}`,
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
      `Refusing to format ${agentFile} — file has parse errors.`,
      "Run agentscript_authoring compile/check to see them and fix first.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: agentFile },
      },
    );
  }

  const formatted = doc.emit();
  if (formatted === source) {
    const details = withAgentScriptBranchState(
      {
        ok: true as const,
        action: "compile.format" as const,
        agent_file: agentFile,
        path: agentFile,
        changed: false,
        bytes_changed: 0,
      },
      [agentFileEvent(agentFile, "compile.format"), formatEvent(agentFile, false)],
    );
    return toolOk(details, `✓ ${agentFile} already canonically formatted`);
  }
  await writeFile(agentFile, formatted, "utf8");
  invalidateAgentScriptAnalysis(agentFile);
  const details = withAgentScriptBranchState(
    {
      ok: true as const,
      action: "compile.format" as const,
      agent_file: agentFile,
      path: agentFile,
      changed: true,
      bytes_changed: formatted.length - source.length,
    },
    [agentFileEvent(agentFile, "compile.format"), formatEvent(agentFile, true)],
  );
  return toolOk(details, `✨ ${agentFile} formatted (Δ ${formatted.length - source.length} bytes)`);
}

function compileEvents(
  agentFile: string,
  clean: boolean,
  diagnosticCount: number,
  quickFixCount: number,
  source: string,
): AgentScriptBranchStateEvent[] {
  return [
    agentFileEvent(agentFile, source),
    {
      schema_version: 1,
      kind: "compile_result",
      agent_file: agentFile,
      clean,
      diagnostic_count: diagnosticCount,
      quick_fix_count: quickFixCount,
      source,
    },
  ];
}

function formatEvent(agentFile: string, changed: boolean): AgentScriptBranchStateEvent {
  return {
    schema_version: 1,
    kind: "format_result",
    agent_file: agentFile,
    changed,
    source: "compile.format",
  };
}

const MAX_SAMPLE_LINES = 5;

export function renderCheckSummary(
  agentFile: string,
  diagnostics: ReadonlyArray<{
    severity: number;
    code?: string;
    range: { start: { line: number } };
    message: string;
  }>,
  quickFixCount: number,
  dialectName?: string,
): string {
  if (diagnostics.length === 0) {
    return `✓ ${agentFile} compiles clean (${dialectName ?? "unknown dialect"})`;
  }
  const sev1 = diagnostics.filter((d) => d.severity === 1).length;
  const sev2 = diagnostics.filter((d) => d.severity === 2).length;
  const sev3 = diagnostics.filter((d) => d.severity === 3).length;
  const ordered = [...diagnostics].sort((a, b) => a.severity - b.severity);
  const sampleLines = ordered.slice(0, MAX_SAMPLE_LINES).map((d) => {
    const tag = d.severity === 1 ? "E" : d.severity === 2 ? "W" : "I";
    const code = d.code ?? "(no-code)";
    const line = (d.range?.start?.line ?? 0) + 1;
    return `  • [${tag}] ${code} @ L${line}`;
  });
  const overflow = diagnostics.length - sampleLines.length;
  const severitySummary = [`${sev1}E`, `${sev2}W`, ...(sev3 > 0 ? [`${sev3}I`] : [])].join("·");
  const head = `❌ ${agentFile} — ${diagnostics.length} issue(s) (${severitySummary}), ${quickFixCount} fix(es) ready`;
  const lines = [head, ...sampleLines];
  if (overflow > 0) lines.push(`  …and ${overflow} more in details.diagnostics`);
  return lines.join("\n");
}
