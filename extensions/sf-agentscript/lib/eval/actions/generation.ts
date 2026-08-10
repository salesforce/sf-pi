/* SPDX-License-Identifier: Apache-2.0 */
/** Eval generation actions: resolve target ids and generate a starter spec. */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connFromAlias } from "../../../../../lib/common/sf-conn/index.ts";
import { agentFileEvent, withAgentScriptBranchState } from "../../branch-state.ts";
import { resolveAgentIds, type StatusFilter } from "../active-ids.ts";
import { generateSpec } from "../spec-generator.ts";
import { inspectFile } from "../../inspect.ts";
import { isAgentScriptFile } from "../../file-classify.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "../../tool-types.ts";

export interface ResolveEvalActionInput {
  target_org?: string;
  agent_api_name?: string;
  version?: number;
  status?: "Active" | "any";
}

export interface GenerateEvalSpecActionInput {
  action?: string;
  agent_file?: string;
  output_path?: string;
  context_variables?: Array<{ name: string; type?: string; value: string | number | boolean }>;
  include_subagent_tests?: boolean;
  include_action_tests?: boolean;
  include_multi_turn_tests?: boolean;
  include_guardrail?: boolean;
  include_safety_probes?: boolean;
  max_functional_tests?: number;
}

export async function actionResolveActive(
  input: ResolveEvalActionInput,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    // Pin a specific version (any state) when `version` is provided.
    // Otherwise honor the `status` filter (default Active).
    const status: StatusFilter = input.status ?? "Active";
    const ids =
      typeof input.version === "number"
        ? await resolveAgentIds(conn, input.agent_api_name, { version: input.version, signal })
        : status === "Active"
          ? await resolveAgentIds(conn, input.agent_api_name, { status: "Active", signal })
          : await resolveAgentIds(conn, input.agent_api_name, { status: "any", signal });

    // The placeholder-shaped fields ($active_* / $latest_*) reflect the
    // resolution mode so an LLM consumer can copy-paste the right token
    // into a spec without remembering which family applies. When `version`
    // is pinned, neither placeholder family applies cleanly — we surface
    // both shapes so the LLM picks the right one for its workflow.
    const placeholderShapes: Record<string, string | null> = {};
    if (typeof input.version === "number" || status === "any") {
      placeholderShapes.$latest_bot_version_id = ids.bot_version_id;
      placeholderShapes.$latest_planner_id = ids.planner_id;
    }
    if (typeof input.version !== "number" && status === "Active") {
      placeholderShapes.$active_bot_version_id = ids.bot_version_id;
      placeholderShapes.$active_planner_id = ids.planner_id;
    }
    placeholderShapes.$active_bot_id = ids.bot_id;

    return toolOk({
      ok: true as const,
      agent_api_name: input.agent_api_name,
      target_org: input.target_org ?? conn.getUsername() ?? "<default>",
      resolution_mode: typeof input.version === "number" ? `version=${input.version}` : status,
      bot_id: ids.bot_id,
      bot_version_id: ids.bot_version_id,
      version_number: ids.version_number,
      bot_version_status: ids.status,
      planner_id: ids.planner_id,
      ...placeholderShapes,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

export async function actionGenerateSpec(
  ctx: ExtensionContext,
  input: GenerateEvalSpecActionInput,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // Resolve + validate the .agent path before doing any work.
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const agentFile = resolved.absPath;
  if (!isAgentScriptFile(agentFile)) {
    return toolError(`Not an Agent Script file: ${agentFile}`, "Pass a path ending in `.agent`.");
  }

  // Inspect locally; refuse if the file has parse errors (the structural
  // surface is incomplete and would emit nonsense).
  const inspect = await inspectFile(agentFile);
  if (!inspect.ok) {
    return toolError(
      `inspect failed: ${inspect.reason ?? "unknown"}${inspect.reason_detail ? ` — ${inspect.reason_detail}` : ""}`,
      "Run agentscript_authoring compile/check to see and fix the underlying issue.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: agentFile },
      },
    );
  }
  if (inspect.has_parse_errors) {
    return toolError(
      `Agent has ${inspect.parse_error_count} severity-1 parse error(s). The structural surface is incomplete; refusing to generate a spec from it.`,
      "Fix the parse errors first via agentscript_authoring compile/check and mutate/apply_quick_fix.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: agentFile },
      },
    );
  }

  let result;
  try {
    result = generateSpec({
      inspect,
      contextVariables: input.context_variables,
      includeSubagentTests: input.include_subagent_tests,
      includeActionTests: input.include_action_tests,
      includeMultiTurnTests: input.include_multi_turn_tests,
      includeGuardrail: input.include_guardrail,
      includeSafetyProbes: input.include_safety_probes,
      maxFunctionalTests: input.max_functional_tests,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }

  // Persist when output_path is set. Resolve relative to cwd; create parents.
  let writtenPath: string | undefined;
  if (input.output_path) {
    const abs = path.isAbsolute(input.output_path)
      ? input.output_path
      : path.resolve(ctx.cwd, input.output_path);
    try {
      await withFileMutationQueue(abs, async () => {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, JSON.stringify(result.spec, null, 2) + "\n", "utf-8");
      });
      writtenPath = abs;
    } catch (err) {
      return toolError(
        `Failed to write generated spec to ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const summary = result.summary;
  const totals =
    `${summary.total_tests} test(s): ${summary.subagent_tests} subagent, ` +
    `${summary.action_tests} action, ${summary.connected_agent_tests} connected, ` +
    `${summary.multi_turn_tests} multi-turn, ${summary.guardrail_tests} guardrail, ` +
    `${summary.safety_tests} safety`;
  const head = `✨ spec generated for ${path.basename(agentFile)}\n${totals}${writtenPath ? `\nWritten: ${writtenPath}` : ""}`;

  // Hand back the next-step hint so the LLM chains directly into a run.
  // We don't execute it here so the user can edit the spec first if they
  // want to refine wording or add multi-turn scenarios.
  const nextStep = writtenPath
    ? `\n\n→ Next: agentscript_eval action='run' spec_path='${writtenPath}'`
    : "";

  return {
    content: [
      {
        type: "text",
        text: head + nextStep + "\n\n" + JSON.stringify({ summary, spec: result.spec }, null, 2),
      },
    ],
    details: withAgentScriptBranchState(
      {
        ok: true,
        agent_file: agentFile,
        output_path: writtenPath,
        summary,
      },
      [
        agentFileEvent(agentFile, "eval.generate_spec"),
        ...(writtenPath
          ? [
              {
                schema_version: 1 as const,
                kind: "eval_spec" as const,
                spec_path: writtenPath,
                agent_file: agentFile,
                source: "eval.generate_spec",
              },
            ]
          : []),
      ],
    ),
  };
}
