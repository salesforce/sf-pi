/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_authoring — local Agent Script authoring family.
 *
 * Owns the create / compile / inspect / mutate loop. Live preview, eval,
 * and lifecycle stay in their own family tools.
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { renderCompileCall, renderCompileResult } from "./render/compile.ts";
import { renderInspectCall, renderInspectResult } from "./render/inspect.ts";
import { renderMutateCall, renderMutateResult } from "./render/mutate.ts";
import { runCompileAction } from "./authoring/actions/compile.ts";
import { runCreateAction } from "./authoring/actions/create.ts";
import { runInspectAction } from "./authoring/actions/inspect.ts";
import { runMutateAction } from "./authoring/actions/mutate.ts";
import { validateAuthoringParams, type AuthoringParams } from "./authoring/params.ts";
import { toolError } from "./tool-types.ts";

export const AUTHORING_TOOL_NAME = "agentscript_authoring";

const Params = Type.Object({
  verb: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("compile"),
      Type.Literal("inspect"),
      Type.Literal("mutate"),
    ],
    {
      description:
        "Authoring verb. create scaffolds a bundle; compile checks/formats; inspect queries structure/review; mutate edits structurally.",
    },
  ),
  mode: Type.Optional(
    Type.Union(
      [
        Type.Literal("check"),
        Type.Literal("format"),
        Type.Literal("structure"),
        Type.Literal("context_profile"),
        Type.Literal("find_references"),
        Type.Literal("definition"),
        Type.Literal("check_targets"),
        Type.Literal("review"),
        Type.Literal("runtime_smoke"),
        Type.Literal("set_field"),
        Type.Literal("rename"),
        Type.Literal("insert"),
        Type.Literal("delete"),
        Type.Literal("apply_quick_fix"),
      ],
      {
        description:
          "Mode within the verb. compile defaults to check; inspect defaults to structure; mutate requires a mode; create omits mode.",
      },
    ),
  ),
  agent_file: Type.Optional(
    Type.String({
      description:
        "Absolute or workspace-relative path to a `.agent` file. May be omitted only when exactly one current agent_file exists on the Pi branch.",
    }),
  ),
  // create
  bundle_name: Type.Optional(Type.String({ description: "Required for verb='create'." })),
  output_dir: Type.Optional(Type.String({ description: "Override the output bundle directory." })),
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
            Type.Object({ name: Type.String(), description: Type.Optional(Type.String()) }),
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
      { description: "Optional seed for verb='create'." },
    ),
  ),
  overwrite: Type.Optional(
    Type.Boolean({ description: "For verb='create'. Replace existing bundle dir. Default false." }),
  ),
  // compile
  fallback: Type.Optional(
    Type.Union([Type.Literal("none"), Type.Literal("server")], {
      description:
        "For verb='compile' mode='check'. Retry server compile when local rejects due to dialect skew. Requires target_org.",
    }),
  ),
  target_org: Type.Optional(
    Type.String({
      description:
        "sf CLI alias / username. Required for inspect.check_targets; optional for inspect.review org checks and compile server fallback.",
    }),
  ),
  // inspect
  symbol: Type.Optional(
    Type.String({
      description:
        "Required for inspect.find_references and inspect.definition. Format '@<namespace>.<property>'.",
    }),
  ),
  output_path: Type.Optional(
    Type.String({ description: "For inspect.review. Optional Markdown report output path." }),
  ),
  phone_number: Type.Optional(
    Type.String({ description: "Optional phone number for voice surface/runtime checks." }),
  ),
  // mutate
  component: Type.Optional(
    Type.String({ description: "For mutate.set_field. Component path, e.g. topic.billing." }),
  ),
  field: Type.Optional(Type.String({ description: "For mutate.set_field. Field name." })),
  value: Type.Optional(Type.Any({ description: "For mutate.set_field. New scalar value." })),
  from: Type.Optional(
    Type.String({
      description: "For mutate.rename. Source symbol/component, e.g. '@subagent.billing'.",
    }),
  ),
  to: Type.Optional(
    Type.String({
      description: "For mutate.rename. Target symbol/component, e.g. '@subagent.account_billing'.",
    }),
  ),
  parent: Type.Optional(
    Type.String({ description: "For mutate.insert guidance. Parent component path." }),
  ),
  child: Type.Optional(Type.Any({ description: "For mutate.insert guidance. Child node." })),
  target: Type.Optional(
    Type.String({ description: "For mutate.delete guidance. Component path to remove." }),
  ),
  diagnostic_code: Type.Optional(
    Type.String({ description: "For mutate.apply_quick_fix. Diagnostic code." }),
  ),
  line: Type.Optional(
    Type.Number({ description: "For mutate.apply_quick_fix. 1-based diagnostic line." }),
  ),
  fix_index: Type.Optional(Type.Number({ description: "For mutate.apply_quick_fix. Default 0." })),
  dry_run: Type.Optional(
    Type.Boolean({ description: "For mutate modes. Return diff/proposed source without writing." }),
  ),
});

export function registerAuthoringTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: AUTHORING_TOOL_NAME,
    label: "Agent Script authoring",
    description:
      "Family tool for local Agent Script authoring: create bundles, compile/check or format, inspect structure/references/targets/review, and mutate `.agent` files. Uses verb + mode; live preview/eval/lifecycle are separate tools.",
    renderCall: (args, theme) => {
      const p = args as AuthoringParams;
      if (p.verb === "compile")
        return renderCompileCall({ action: compileMode(p), path: p.agent_file }, theme);
      if (p.verb === "inspect")
        return renderInspectCall(
          { action: inspectMode(p), path: p.agent_file, symbol: p.symbol },
          theme,
        );
      if (p.verb === "mutate")
        return renderMutateCall(
          {
            op: p.mode,
            path: p.agent_file,
            component: p.component,
            field: p.field,
            diagnostic_code: p.diagnostic_code,
            line: p.line,
            dry_run: p.dry_run,
          },
          theme,
        );
      return renderInspectCall({ action: "create", path: p.bundle_name }, theme);
    },
    renderResult: (result, opts, theme, context) => {
      const args = (context?.args ?? {}) as AuthoringParams;
      const details = ((result as { details?: Record<string, unknown> }).details ?? {}) as Record<
        string,
        unknown
      >;
      if (args.verb === "compile" || String(details.action ?? "").startsWith("compile.")) {
        return renderCompileResult(adaptCompileResult(result), opts, theme);
      }
      if (args.verb === "mutate" || String(details.action ?? "").startsWith("mutate.")) {
        return renderMutateResult(result, opts, theme);
      }
      return renderInspectResult(adaptInspectResult(result), opts, theme);
    },
    promptSnippet:
      "Create, compile, inspect, review, and structurally mutate Agent Script `.agent` files via one authoring family tool.",
    promptGuidelines: [
      "agentscript_authoring uses `verb` + `mode`: verb=create|compile|inspect|mutate. compile mode defaults to check; inspect mode defaults to structure; mutate requires mode.",
      "Use `agent_file` for `.agent` paths. It may be omitted only when exactly one current agent_file exists on the current Pi branch; ambiguity returns structured candidates instead of guessing.",
      "Read-only modes: compile/check and inspect/*, except inspect/check_targets and inspect/review with target_org perform read-only org checks. Write modes: create, compile/format, mutate/* (unless dry_run=true).",
      "Preferred loop: compile/check → inspect/structure or inspect/review → mutate with dry_run for risky edits → compile/check again → preview/eval/lifecycle.",
      "Use mutate/apply_quick_fix from compile quick_fixes.apply_via. Do not use the generic edit tool when mutate supports the change.",
      "inspect/review is deterministic v1: readiness is ready | ready_with_warnings | blocked | partial; no numeric score and no hidden LLM review. Pass output_path to write a Markdown report.",
      "inspect/runtime_smoke is explicit and read-only. Use it after a test call/message to diagnose recent VoiceCall, AgentWork, and MessagingSession records; requires target_org.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const p = params as AuthoringParams;
      const valid = validateAuthoringParams(p);
      if (valid.ok === false) return toolError("INVALID_PARAMS", valid.error);
      switch (p.verb) {
        case "create":
          return runCreateAction(ctx, p);
        case "compile":
          return runCompileAction(ctx, p);
        case "inspect":
          return runInspectAction(ctx, p);
        case "mutate":
          return runMutateAction(ctx, p);
        default:
          return toolError(
            "INVALID_PARAMS",
            `Unsupported authoring verb '${String((p as { verb?: unknown }).verb)}'.`,
          );
      }
    },
  });
}

function compileMode(p: AuthoringParams): "check" | "format" {
  return p.mode === "format" ? "format" : "check";
}

function inspectMode(p: AuthoringParams): string {
  return p.mode && p.verb === "inspect" ? p.mode : "structure";
}

function adaptCompileResult(result: unknown): {
  details?: Record<string, unknown>;
  content?: unknown[];
} {
  const row = result as { details?: Record<string, unknown>; content?: unknown[] };
  const details = row.details ?? {};
  const action = String(details.action ?? "compile.check").replace(/^compile\./, "") as
    | "check"
    | "format";
  return { ...row, details: { ...details, action, path: details.path ?? details.agent_file } };
}

function adaptInspectResult(result: unknown): {
  details?: Record<string, unknown>;
  content?: unknown[];
} {
  const row = result as { details?: Record<string, unknown>; content?: unknown[] };
  const details = row.details ?? {};
  const action = String(details.action ?? "inspect.structure").replace(/^inspect\./, "");
  return { ...row, details: { ...details, action, path: details.path ?? details.agent_file } };
}
