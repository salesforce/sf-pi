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
  action: StringEnum(["status", "doctor", "install", "debug", "sdk"] as const, {
    description:
      "status: cached, no network. doctor: live read-only checks. install: plan (default) or run a global npm install of the Fin CLI. debug: redacted support bundle, or arm/disarm verbose tracing. sdk: Fin-as-code reads (enables the Fin SDK on first use).",
  }),
  operation: Type.Optional(
    StringEnum(["manifest", "download"] as const, {
      description:
        "sdk only: manifest summarizes procedures, workflows, guidance, and connectors; download fetches and extracts all Fin SDK resources locally.",
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
        "install only: execute the planned install. Execution intent, not approval; SF Guardrail mediates it.",
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
  action: "status" | "doctor" | "install" | "debug" | "sdk";
  operation?: "manifest" | "download";
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
    description:
      "Manage the Fin (formerly Intercom) workspace connection used by SF Fin: cached status, live read-only doctor, Fin CLI install/update through global npm (planned by default, Guardrail-mediated when executed), and redacted debug bundles or one-shot verbose tracing.",
    promptSnippet: "Check, install, and debug the Fin workspace CLI connection.",
    promptGuidelines: [
      "Use sf_fin action='status' first; run action='doctor' when verified workspace identity or install readiness is needed.",
      "For a missing or outdated Fin CLI, call sf_fin action='install' without allow_mutation to show the plan, then with allow_mutation=true to execute; SF Guardrail mediates execution.",
      `Never ask the user to paste a Fin token into chat; direct them to /login ${PROVIDER_NAME}, which masks the token.`,
      "Use sf_fin action='debug' for a redacted support bundle; arm verbose='on' only when a doctor failure needs the CLI's HTTP trace.",
      "Use sf_fin action='sdk' operation='manifest' or 'download' for Fin-as-code reads; SF Fin enables the Fin SDK on first use (Guardrail-mediated) and never runs `intercom fin …` through bash.",
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

      if (input.action === "sdk") {
        const result = await service.sdk(ctx, input.operation ?? "manifest");
        return {
          content: [{ type: "text", text: result.text }],
          details: {
            action: "sdk",
            operation: input.operation ?? "manifest",
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
