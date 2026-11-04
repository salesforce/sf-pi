/* SPDX-License-Identifier: Apache-2.0 */
/**
 * The single SF Fin family tool.
 *
 * status/doctor/debug are read-only. install plans by default; executing it
 * requires `allow_mutation=true`, which is an Execution Intent Flag only. SF
 * Guardrail classifies `sf_fin install` with `allow_mutation=true` as a
 * native "Fin CLI install" mutation and owns approval (HITL or Power Tool
 * Mode) before this tool runs.
 */
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { FinService } from "./service.ts";
import { statusText } from "./service.ts";
import { COMMAND_NAME, PROVIDER_NAME, TOOL_NAME } from "./types.ts";

const Params = Type.Object({
  action: StringEnum(
    [
      "status",
      "doctor",
      "install",
      "debug",
      "sdk",
      "surfaces",
      "agent",
      "setup",
      "workspace",
    ] as const,
    {
      description:
        "status: cached, no network. doctor: live read-only checks. install: plan (default) or run a global npm install of the Fin CLI. debug: redacted support bundle, or arm/disarm verbose tracing. sdk: Fin-as-code reads and authoring (enables the Fin SDK on first use). surfaces: compare the installed Fin CLI, Intercom MCP, and Fin Agent API, and say which SF Fin uses per capability (local, read-only). agent: Fin Agent API test harness (needs granted access and /login sf-fin-agent). setup: read-only check of one workspace's credentials, what they unlock, and what is missing. workspace: list, add, use, or remove named Fin workspace profiles (no credentials).",
    },
  ),
  operation: Type.Optional(
    StringEnum(
      [
        "manifest",
        "download",
        "validate",
        "upload",
        "upload_simulations",
        "simulate",
        "publish",
        "pause",
        "create_data_connector",
        "guidance_state",
        "access",
        "capabilities",
        "run",
        "list",
        "add",
        "use",
        "remove",
      ] as const,
      {
        description:
          "sdk only. manifest: summarize resources. download: fetch and extract Fin SDK resources. validate: check a procedure.yaml against the workspace schema and draft rules (local). upload: upload a procedure.yaml as an unpublished draft with round-trip verify. upload_simulations: upload a simulation_set YAML (type, procedure_id, tests[]; each test validated against the workspace simulation schema; tests with an id update, others are added). simulate: optionally generate, then run simulations for a procedure_id (Fin only simulates live procedures). publish / pause: set a procedure_id live or paused; plans by default, executes with allow_mutation=true (SF Guardrail mediates). A procedure never returns to draft. validate/upload also accept guidance (type: guidance; uploads paused) and data connectors (type: data_connector; uploads draft). create_data_connector: create a named draft connector and return its id. guidance_state: set guidance_id live or paused (plans by default; allow_mutation=true executes). agent only: access (check Fin Agent API access), capabilities (list a test user's procedures), run (scripted conversation). workspace only: list, add (name, kind), use (name), remove (name).",
      },
    ),
  ),
  file: Type.Optional(
    Type.String({
      description:
        "sdk validate/upload: path to a procedure.yaml; upload_simulations: path to a simulation_set YAML (relative to cwd or absolute).",
    }),
  ),
  note: Type.Optional(
    Type.String({ description: "sdk upload/publish/pause: version note recorded with the save." }),
  ),
  procedure_id: Type.Optional(
    Type.String({
      description: "sdk simulate/publish/pause: Fin procedure id returned by upload.",
    }),
  ),
  generate: Type.Optional(
    Type.Boolean({
      description: "sdk simulate: generate simulations before running them. Default true.",
    }),
  ),
  name: Type.Optional(
    Type.String({
      description:
        "sdk create_data_connector: connector name. workspace add/use/remove: workspace name (lowercase, for example test).",
    }),
  ),
  workspace: Type.Optional(
    Type.String({
      description:
        "Fin workspace profile to act on (default: the active workspace). Each workspace has its own sign-ins.",
    }),
  ),
  kind: Type.Optional(
    StringEnum(["test", "prod"] as const, {
      description:
        "workspace add: test (default) or prod. SF Guardrail treats prod like a production org.",
    }),
  ),
  wants: Type.Optional(
    Type.Array(StringEnum(["build", "operator", "test"] as const), {
      description:
        "setup: capabilities you need (build in Fin, Intercom MCP/Operator, Fin Agent API testing). Default: all.",
    }),
  ),
  guidance_id: Type.Optional(
    Type.String({ description: "sdk guidance_state: numeric Fin guidance id." }),
  ),
  state: Type.Optional(
    StringEnum(["live", "paused"] as const, {
      description: "sdk guidance_state: target state.",
    }),
  ),
  message: Type.Optional(
    Type.String({
      description:
        "agent run: opening user message (asks Fin when no procedure_id; optional trigger for a procedure run).",
    }),
  ),
  replies: Type.Optional(
    Type.Array(Type.String(), {
      description: "agent run: user replies sent in order each time Fin awaits a reply.",
      maxItems: 8,
    }),
  ),
  user_id: Type.Optional(
    Type.String({
      description:
        "agent capabilities/run: test user external id; a synthetic id is generated when omitted.",
    }),
  ),
  version: Type.Optional(
    Type.String({
      description:
        "install only: exact Fin CLI version such as 0.14.1. Defaults to latest allowed by npm policy.",
    }),
  ),
  allow_mutation: Type.Optional(
    Type.Boolean({
      description:
        "install, sdk publish/pause: execute the planned change. Execution intent, not approval; SF Guardrail mediates it.",
    }),
  ),
  verbose: Type.Optional(
    StringEnum(["on", "off"] as const, {
      description: "debug only: arm verbose tracing for the next doctor run(s), or turn it off.",
    }),
  ),
  runs: Type.Optional(
    Type.Number({ description: "debug verbose=on only: number of doctor runs to trace (1–5)." }),
  ),
});

type Params = {
  action:
    | "status"
    | "doctor"
    | "install"
    | "debug"
    | "sdk"
    | "surfaces"
    | "agent"
    | "setup"
    | "workspace";
  operation?:
    | "manifest"
    | "download"
    | "validate"
    | "upload"
    | "upload_simulations"
    | "simulate"
    | "publish"
    | "pause"
    | "create_data_connector"
    | "guidance_state"
    | "access"
    | "capabilities"
    | "run"
    | "list"
    | "add"
    | "use"
    | "remove";
  workspace?: string;
  kind?: "test" | "prod";
  wants?: Array<"build" | "operator" | "test">;
  file?: string;
  name?: string;
  guidance_id?: string;
  state?: "live" | "paused";
  message?: string;
  replies?: string[];
  user_id?: string;
  note?: string;
  procedure_id?: string;
  generate?: boolean;
  version?: string;
  allow_mutation?: boolean;
  verbose?: "on" | "off";
  runs?: number;
};

export function registerSfFinTool(
  pi: ExtensionAPI,
  service: FinService,
  meta: () => { sfPiVersion?: string; piVersion?: string },
): void {
  pi.registerTool<typeof Params>({
    name: TOOL_NAME,
    label: "SF Fin",
    // setup reads the workspace's Intercom MCP connection (read-only
    // list_articles) to prove its workspace id; declare it so Pi finishes
    // registering that server's tools before the call runs.
    reachesTools: (input) => {
      const params = input as Params;
      if (params.action !== "setup") return [];
      const name = params.workspace?.trim();
      return [name && name !== "default" ? `intercom_${name.replace(/-/g, "_")}` : "intercom"];
    },
    description:
      "Manage the Fin (formerly Intercom) workspace connection used by SF Fin: cached status, live read-only doctor, Fin CLI install/update through global npm (planned by default, Guardrail-mediated when executed), redacted debug bundles or one-shot verbose tracing, Fin-as-code authoring (procedures, simulations, guidance, data connectors), a CLI vs MCP surface comparison, and a Fin Agent API test harness.",
    promptSnippet: "Check, install, and debug the Fin workspace CLI connection.",
    promptGuidelines: [
      "Use sf_fin action='status' first; run action='doctor' when verified workspace identity or install readiness is needed.",
      "For a missing or outdated Fin CLI, call sf_fin action='install' without allow_mutation to show the plan, then with allow_mutation=true to execute; SF Guardrail mediates execution.",
      `Never ask the user to paste a Fin token into chat; direct them to /login ${PROVIDER_NAME}, which masks the token.`,
      "Use sf_fin action='debug' for a redacted support bundle; arm verbose='on' only when a doctor failure needs the CLI's HTTP trace.",
      "Use sf_fin action='sdk' operation='manifest' or 'download' for Fin-as-code reads; SF Fin enables the Fin SDK on first use (Guardrail-mediated) and never runs `intercom fin …` through bash.",
      "For a procedure, run sf_fin sdk operation='validate' file=…, then operation='upload' (unpublished draft, round-trip verified), then operation='simulate' procedure_id=…; uploads never set state, and publishing is separate.",
      "Guidance and data connectors use the same sdk validate/upload (by file `type`); guidance uploads paused and goes live only through sdk operation='guidance_state' (plan, then allow_mutation=true); data connectors upload as drafts and are published in the Intercom UI.",
      "Use sf_fin action='surfaces' to decide between the Fin CLI, the Intercom MCP, and the Fin Agent API for a capability.",
      "Use sf_fin action='agent' operation='access' before Fin Agent API runs; never ask for the Fin Agent API key in chat (use /login sf-fin-agent). Runs Fin resolves are billable outcomes.",
    ],
    parameters: Params,
    renderCall: (args, theme) => {
      const input = args as Params;
      const bits: string[] = [input.action ?? "status"];
      if (input.action === "install") bits.push(input.allow_mutation ? "execute" : "plan");
      if (input.version) bits.push(input.version);
      if (input.verbose) bits.push(`verbose ${input.verbose}`);
      if (input.operation) bits.push(input.operation);
      return new Text(
        theme.fg("toolTitle", theme.bold("🐟 SF Fin ")) + theme.fg("muted", bits.join(" · ")),
        0,
        0,
      );
    },
    async execute(_id, params, _signal, _onUpdate, ctx) {
      const input = params as Params;
      const workspace = input.workspace?.trim() || undefined;

      if (input.action === "workspace") {
        const operation =
          input.operation === "add" || input.operation === "use" || input.operation === "remove"
            ? input.operation
            : "list";
        const result = service.workspace(
          operation === "list"
            ? { operation }
            : operation === "add"
              ? { operation, name: input.name, kind: input.kind }
              : { operation, name: input.name },
        );
        return {
          content: [{ type: "text", text: result.text }],
          details: { action: "workspace", operation, ok: result.ok, ...result.details },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (input.action === "setup") {
        const result = await service.setup(
          { ...ctx, executeTool: (name, args) => ctx.executeTool(name, args) },
          { workspace, wants: input.wants },
        );
        return {
          content: [{ type: "text", text: result.text }],
          details: { action: "setup", ok: result.ok, ...result.details },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (input.action === "doctor") {
        const result = await service.doctor(ctx);
        return {
          content: [{ type: "text", text: result.text }],
          details: {
            action: "doctor",
            outcome: result.outcome,
            identity: result.snapshot.identity,
            cliVersion: result.snapshot.cliVersion,
            latestVersion: result.snapshot.latestVersion,
            ...(result.tracePath ? { tracePath: result.tracePath } : {}),
            ...(result.outcome === "ok" ? {} : { recover_via: recoverVia(result.outcome) }),
          },
          ...(result.outcome === "ok" ? {} : { isError: true }),
        };
      }

      if (input.action === "install") {
        const plan = await service.planInstall(input.version?.trim() || undefined);
        if (input.allow_mutation !== true || (plan.kind !== "install" && plan.kind !== "update")) {
          const text =
            plan.kind === "install" || plan.kind === "update"
              ? `${plan.reason}\nPlanned command: ${plan.command}\nCall sf_fin action='install' with allow_mutation=true${input.version ? ` and version='${plan.version}'` : ""} to execute.`
              : [plan.reason, plan.kind === "refused" ? plan.manual : undefined]
                  .filter(Boolean)
                  .join("\n");
          return {
            content: [{ type: "text", text }],
            details: { action: "install", phase: "plan", plan },
            ...(plan.kind === "refused" ? { isError: true } : {}),
          };
        }
        const result = await service.install(plan);
        return {
          content: [{ type: "text", text: result.text }],
          details: {
            action: "install",
            phase: "execute",
            plan,
            ok: result.ok,
            cliVersion: result.snapshot?.cliVersion,
          },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (input.action === "surfaces") {
        const result = await service.surfaces();
        return {
          content: [{ type: "text", text: result.text }],
          details: { action: "surfaces", ok: result.ok, ...result.details },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (input.action === "agent") {
        const operation =
          input.operation === "capabilities" || input.operation === "run"
            ? input.operation
            : "access";
        const result = await service.agent(
          ctx,
          operation === "run"
            ? {
                operation,
                userId: input.user_id,
                run: {
                  procedureId: input.procedure_id,
                  message: input.message,
                  replies: input.replies,
                  userId: input.user_id,
                },
              }
            : operation === "capabilities"
              ? { operation, userId: input.user_id }
              : { operation },
          workspace,
        );
        return {
          content: [{ type: "text", text: result.text }],
          details: { action: "agent", operation, ok: result.ok, ...result.details },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (
        input.action === "sdk" &&
        (input.operation === "create_data_connector" || input.operation === "guidance_state")
      ) {
        const result = await service.procedure(
          ctx,
          input.operation === "create_data_connector"
            ? { operation: "create_data_connector", name: input.name }
            : {
                operation: "guidance_state",
                guidanceId: input.guidance_id,
                state: input.state,
                execute: input.allow_mutation === true,
              },
          workspace,
        );
        return {
          content: [{ type: "text", text: result.text }],
          details: { action: "sdk", operation: input.operation, ok: result.ok, ...result.details },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (
        input.action === "sdk" &&
        (input.operation === "validate" ||
          input.operation === "upload" ||
          input.operation === "upload_simulations" ||
          input.operation === "simulate" ||
          input.operation === "publish" ||
          input.operation === "pause")
      ) {
        const result = await service.procedure(
          ctx,
          input.operation === "publish" || input.operation === "pause"
            ? {
                operation: input.operation,
                procedureId: input.procedure_id,
                execute: input.allow_mutation === true,
                note: input.note,
              }
            : input.operation === "simulate"
              ? { operation: "simulate", procedureId: input.procedure_id, generate: input.generate }
              : input.operation === "upload"
                ? { operation: "upload", file: input.file, note: input.note }
                : input.operation === "upload_simulations"
                  ? { operation: "upload_simulations", file: input.file }
                  : { operation: "validate", file: input.file },
          workspace,
        );
        return {
          content: [{ type: "text", text: result.text }],
          details: { action: "sdk", operation: input.operation, ok: result.ok, ...result.details },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (input.action === "sdk") {
        const operation = input.operation === "download" ? "download" : "manifest";
        const result = await service.sdk(ctx, operation, workspace);
        return {
          content: [{ type: "text", text: result.text }],
          details: {
            action: "sdk",
            operation,
            ok: result.ok,
            enabledNow: result.enabledNow,
            ...result.details,
          },
          ...(result.ok ? {} : { isError: true }),
        };
      }

      if (input.action === "debug") {
        if (input.verbose) {
          const text = service.setVerbose(input.verbose === "on", input.runs);
          return {
            content: [{ type: "text", text }],
            details: { action: "debug", verbose: input.verbose },
          };
        }
        return {
          content: [{ type: "text", text: service.debugBundle(meta()) }],
          details: { action: "debug", phase: "bundle" },
        };
      }

      return {
        content: [{ type: "text", text: statusText() }],
        details: { action: "status" },
      };
    },
  });
}

function recoverVia(outcome: string): Record<string, string> {
  switch (outcome) {
    case "cli_missing":
    case "cli_outdated":
      return { tool: "sf_fin action='install'", command: `/${COMMAND_NAME} install` };
    case "not_connected":
    case "auth_expired":
      return { login: `/login ${PROVIDER_NAME}` };
    default:
      return { tool: "sf_fin action='debug'", command: `/${COMMAND_NAME} debug` };
  }
}
