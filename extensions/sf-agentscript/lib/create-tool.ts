/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_create — scaffold a new `.agent` + bundle-meta.xml.
 *
 * Local-first: validates the generated source via the vendored SDK before
 * writing to disk. Refuses to overwrite existing bundles unless overwrite=true.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBundle, type AgentJobSpec } from "./create.ts";
import { toolError, toolOk } from "./tool-types.ts";

export const CREATE_TOOL_NAME = "agentscript_create";

const Params = Type.Object({
  bundle_name: Type.String({
    description: "Bundle name, e.g. 'Billing_Bot'. Used as the agent and directory name.",
  }),
  output_dir: Type.Optional(
    Type.String({
      description:
        "Override the bundle directory. Default: <defaultPackageDir>/main/default/aiAuthoringBundles/<bundle_name>/",
    }),
  ),
  template: Type.Optional(
    Type.Union([Type.Literal("minimal"), Type.Literal("agentforce-default")], {
      description: "Scaffold template. Default 'agentforce-default'.",
    }),
  ),
  job_spec: Type.Optional(
    Type.Object(
      {
        description: Type.Optional(Type.String()),
        agent_user: Type.Optional(Type.String()),
        topics: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String(),
              description: Type.Optional(Type.String()),
            }),
          ),
        ),
        variables: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String(),
              type: Type.Union([
                Type.Literal("string"),
                Type.Literal("boolean"),
                Type.Literal("number"),
              ]),
              mutable: Type.Optional(Type.Boolean()),
              default: Type.Optional(Type.Any()),
              description: Type.Optional(Type.String()),
            }),
          ),
        ),
      },
      { description: "Optional seed: agent description, agent_user, topics, variables." },
    ),
  ),
  overwrite: Type.Optional(
    Type.Boolean({
      description: "Replace an existing bundle dir. Default false (refuse to clobber).",
    }),
  ),
});

interface Input {
  bundle_name: string;
  output_dir?: string;
  template?: "minimal" | "agentforce-default";
  job_spec?: AgentJobSpec;
  overwrite?: boolean;
}

export function registerCreateTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: CREATE_TOOL_NAME,
    label: "Agent Script — create",
    description:
      "Scaffold a new `.agent` file and the matching bundle-meta.xml from an optional job spec. Validates the generated source against the vendored SDK before writing — template bugs surface as a tool-error, not as a corrupt file.",
    promptSnippet:
      "Create a new Agentforce authoring bundle (.agent + bundle-meta.xml) from a name + optional spec.",
    promptGuidelines: [
      "Use this for the `create` verb of the inspect/create/correct/self-recover loop. Pass a job_spec when you have one (description, topics, variables); leave it empty for the default scaffold.",
      "Refuses to overwrite an existing bundle directory unless `overwrite: true` is passed — the error returns a `recover_via` with overwrite set so the LLM can retry intentionally.",
      "Returns `next_steps` you can chain immediately (agentscript_inspect, agentscript_preview).",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = params as Input;
      const result = await createBundle({
        cwd: ctx.cwd,
        bundle_name: input.bundle_name,
        output_dir: input.output_dir,
        template: input.template,
        job_spec: input.job_spec,
        overwrite: input.overwrite,
      });

      if (result.ok === false) {
        const recoverVia =
          result.reason === "exists"
            ? {
                tool: CREATE_TOOL_NAME,
                params: {
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
      return toolOk(
        {
          ok: true as const,
          bundle_dir: result.bundle_dir,
          agent_path: result.agent_path,
          meta_path: result.meta_path,
          diagnostics_count: result.diagnostics_count,
          agent_type: result.agent_type,
          ...(result.default_agent_user ? { default_agent_user: result.default_agent_user } : {}),
          next_steps: result.next_steps,
        },
        `📦 Created ${input.bundle_name}\n${result.agent_path}\n${result.meta_path}\n${typeLine}`,
      );
    },
  });
}
