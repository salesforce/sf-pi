/* SPDX-License-Identifier: Apache-2.0 */
/** Create action for agentscript_authoring. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { agentFileEvent, withAgentScriptBranchState } from "../../branch-state.ts";
import { createBundle, type AgentJobSpec } from "../../create.ts";
import { toolError, toolOk, type ToolError } from "../../tool-types.ts";
import type { AuthoringParams } from "../params.ts";

export async function runCreateAction(
  ctx: ExtensionContext,
  input: AuthoringParams,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const result = await createBundle({
    cwd: ctx.cwd,
    bundle_name: input.bundle_name as string,
    output_dir: input.output_dir,
    template: input.template,
    job_spec: input.job_spec as AgentJobSpec | undefined,
    overwrite: input.overwrite,
  });

  if (result.ok === false) {
    const recoverVia =
      result.reason === "exists"
        ? {
            tool: "agentscript_authoring",
            params: {
              verb: "create",
              bundle_name: input.bundle_name,
              ...(input.output_dir ? { output_dir: input.output_dir } : {}),
              ...(input.template ? { template: input.template } : {}),
              ...(input.job_spec ? { job_spec: input.job_spec } : {}),
              overwrite: true,
            },
          }
        : result.reason === "sdk_unavailable" || result.reason === "template_compile_failed"
          ? { tool: "sf-agentscript", params: { action: "doctor" } }
          : undefined;
    return toolError(
      result.reason_detail ?? `Create failed (${result.reason}).`,
      undefined,
      recoverVia,
    );
  }

  const typeLine =
    result.agent_type === "AgentforceServiceAgent"
      ? `agent_type: AgentforceServiceAgent (default_agent_user=${result.default_agent_user})`
      : `agent_type: AgentforceEmployeeAgent (no default_agent_user needed for activation)`;

  const details = withAgentScriptBranchState(
    {
      ok: true as const,
      action: "create" as const,
      bundle_dir: result.bundle_dir,
      agent_file: result.agent_path,
      agent_path: result.agent_path,
      meta_path: result.meta_path,
      diagnostics_count: result.diagnostics_count,
      agent_type: result.agent_type,
      ...(result.default_agent_user ? { default_agent_user: result.default_agent_user } : {}),
      next_steps: result.next_steps,
    },
    [
      agentFileEvent(result.agent_path, "create"),
      {
        schema_version: 1,
        kind: "inspect_result",
        agent_file: result.agent_path,
        mode: "created",
        source: "create",
      },
    ],
  );

  return toolOk(
    details,
    `📦 Created ${input.bundle_name}\n${result.agent_path}\n${result.meta_path}\n${typeLine}`,
  );
}
