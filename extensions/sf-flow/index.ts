/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-flow behavior contract
 *
 * SF Flow is a lean Flow Lifecycle Extension. It owns core-five plus
 * Omni-Channel authoring plans, local Flow inspection/diagnostics, check-only validation, targeted
 * Flow tests, compact evidence, and Mermaid topology. Normal Pi file tools own
 * source edits; explicit guarded lifecycle actions own one-Flow activation and
 * deterministic deactivation.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|--------------------------------------------
 *   session_start          | Register the sf_flow lifecycle tool
 *   successful Flow edit   | Run fast local diagnostics; stay silent when clean
 *   /sf-flow (no args)     | Open the extension detail in the SF Pi Manager
 *   /sf-flow status        | Print status as plain text (headless-safe)
 *   /sf-flow help          | Print command usage as plain text
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
  getFirstTokenCompletionsFromActions,
  type SfPiCommandAction,
} from "../../lib/common/command-actions.ts";
import type { InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { beginSalesforceConnectionSession } from "../../lib/common/sf-conn/index.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { analyzeFlowFile, isFlowFile } from "./lib/analyzer.ts";
import {
  advanceRepairLoop,
  createRepairLoopState,
  type FlowRepairLoopState,
} from "./lib/repair-loop.ts";
import { registerSfFlowTool } from "./lib/sf-flow-tool.ts";

const COMMAND_NAME = "sf-flow";
type SfFlowCommandAction = "status" | "help";

interface PendingFlowTopology {
  mermaid: string;
  label: string;
  nodes?: number;
  totalNodes?: number;
  truncated: boolean;
}

const COMMAND_ACTIONS: SfPiCommandAction<SfFlowCommandAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF Flow extension status.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command and tool usage.",
    group: "Reference",
  },
];

export default function (pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-flow")) return;
  const repairState = createRepairLoopState();
  const pendingTopologies = new Map<string, PendingFlowTopology>();

  pi.on("session_start", async (event) => {
    repairState.files.clear();
    pendingTopologies.clear();
    beginSalesforceConnectionSession(event);
    registerSfFlowTool(pi);
  });
  pi.on("tool_result", async (event, ctx) => {
    captureFlowTopology(event, pendingTopologies);
    return handleToolResult(event, ctx, repairState);
  });
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant" || pendingTopologies.size === 0) return undefined;
    if (event.message.content.some((part) => part.type === "toolCall")) return undefined;

    const existingText = event.message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const topologies = [...pendingTopologies.values()];
    pendingTopologies.clear();
    const missing = topologies.filter((topology) => !existingText.includes(topology.mermaid));
    if (!missing.length) return undefined;

    return {
      message: {
        ...event.message,
        content: [
          ...event.message.content,
          {
            type: "text" as const,
            text: `\n\n${missing.map(topologyMarkdown).join("\n\n")}`,
          },
        ],
      },
    };
  });
  pi.on("agent_settled", () => {
    pendingTopologies.clear();
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Flow — Flow lifecycle status & controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(COMMAND_ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const action = (args ?? "").trim().toLowerCase();
        if (action === "" && ctx.hasUI) {
          await openInManager(pi, ctx);
          return;
        }
        await handleCommand(ctx, action === "" ? "status" : action);
      });
    },
  });
}

function captureFlowTopology(
  event: ToolResultEvent,
  pending: Map<string, PendingFlowTopology>,
): void {
  if (event.toolName !== "sf_flow" || event.isError) return;
  const details = event.details as
    | {
        file?: unknown;
        local_analysis?: { file?: unknown };
        digest?: {
          title?: unknown;
          meta?: unknown;
          topology?: {
            mermaid?: unknown;
            nodes?: unknown;
            total_nodes?: unknown;
            truncated?: unknown;
          };
        };
      }
    | undefined;
  const topology = details?.digest?.topology;
  if (typeof topology?.mermaid !== "string" || !topology.mermaid.trim()) return;
  const firstMeta = Array.isArray(details?.digest?.meta) ? details.digest.meta[0] : undefined;
  const file = [details?.file, details?.local_analysis?.file, firstMeta].find(
    (value): value is string => typeof value === "string" && Boolean(value.trim()),
  );
  const label =
    file?.split(/[\\/]/).filter(Boolean).at(-1) ??
    (typeof details?.digest?.title === "string" ? details.digest.title : "Flow");
  const identity = file?.split(/[\\/]/).filter(Boolean).at(-1) ?? label;
  pending.set(identity, {
    mermaid: topology.mermaid,
    label:
      label
        .replace(/[\r\n`#]+/g, " ")
        .trim()
        .slice(0, 120) || "Flow",
    nodes: typeof topology.nodes === "number" ? topology.nodes : undefined,
    totalNodes: typeof topology.total_nodes === "number" ? topology.total_nodes : undefined,
    truncated: topology.truncated === true,
  });
}

function topologyMarkdown(topology: PendingFlowTopology): string {
  const count =
    topology.truncated && topology.nodes !== undefined && topology.totalNodes !== undefined
      ? ` Showing ${topology.nodes} of ${topology.totalNodes} executable elements.`
      : "";
  const note = topology.truncated
    ? `\n\n_Topology is bounded.${count} Open the \`.mmd\` artifact for the complete graph._`
    : "";
  return `### Flow Topology — ${topology.label}\n\n_Normal arrows show the happy path; labeled arrows are outcomes; dashed arrows are faults; diamonds are decisions; hexagons are loops._\n\n\`\`\`mermaid\n${topology.mermaid}\n\`\`\`${note}`;
}

async function handleToolResult(
  event: ToolResultEvent,
  ctx: ExtensionContext,
  repairState: FlowRepairLoopState,
) {
  if (event.isError || (event.toolName !== "write" && event.toolName !== "edit")) return undefined;
  const input = event.input as { path?: unknown };
  if (typeof input.path !== "string" || !isFlowFile(input.path)) return undefined;
  try {
    const analysis = await analyzeFlowFile(input.path, ctx.cwd, { profile: "generation" });
    const repair = advanceRepairLoop(repairState, input.path, analysis.findings);
    if (repair.status === "clean") return undefined;
    const visible = repair.actionable.slice(0, 8);
    const text = [
      `SF Flow diagnostics · ${repair.message}`,
      ...visible.map(
        (finding) =>
          `${finding.line}:${finding.column} ${finding.severity} ${finding.rule_id} ${finding.message}`,
      ),
      ...(repair.actionable.length > visible.length
        ? [
            `+${repair.actionable.length - visible.length} more actionable finding(s); run sf_flow diagnose.file.`,
          ]
        : []),
      ...(repair.status === "continue"
        ? [
            "Use normal file edits for business logic. Run sf_flow diagnose.file to inspect source-bound safe quick fixes.",
          ]
        : [
            "No further automatic repair guidance will be issued for this file in the current session.",
          ]),
    ].join("\n");
    return {
      content: [...event.content, { type: "text" as const, text: `\n\n${text}` }],
      details: {
        ...(typeof event.details === "object" && event.details ? event.details : {}),
        sf_flow_diagnostics: {
          status: analysis.status,
          summary: analysis.summary,
          findings: visible,
          coverage: analysis.coverage,
        },
        sf_flow_repair_loop: repair,
      },
    };
  } catch {
    return undefined;
  }
}

async function openInManager(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: COMMAND_NAME,
    view: "detail",
  });
  if (!opened) ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-flow.", "warning");
}

async function handleCommand(ctx: ExtensionCommandContext, action: string): Promise<void> {
  if (action === "status") {
    await emitOutput(
      ctx,
      [
        "SF Flow is installed.",
        "Use sf_flow for core-five plus queue, direct-agent, skills, availability, and no-route Omni-Channel planning; diagnostics; check-only validation; guarded activation/deactivation; and targeted tests.",
        "Use /sf-flow with no args to open its SF Pi Manager detail page.",
      ].join("\n"),
      "info",
    );
    return;
  }
  if (action === "help") {
    await emitOutput(
      ctx,
      [
        "Commands:",
        "  /sf-flow          Open SF Flow in the SF Pi Manager",
        "  /sf-flow status   Print extension status",
        "  /sf-flow help     Print this help",
        "",
        "Tool actions:",
        "  status, org.preflight",
        "  project.scan, flow.inspect, author.plan, diagnose.file, quality.rules",
        "  fix.apply (source-bound safe fixes only)",
        "  validate.check",
        "  lifecycle.status, deploy.activate, lifecycle.activate, lifecycle.deactivate",
        "  test.discover, test.plan, test.run, test.result, test.rerun",
      ].join("\n"),
      "info",
    );
    return;
  }
  await emitOutput(ctx, `Unknown /${COMMAND_NAME} subcommand: ${action}`, "warning");
}

async function emitOutput(
  ctx: ExtensionCommandContext,
  body: string,
  severity: InfoPanelSeverity,
): Promise<void> {
  if (ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }
  console.info(body);
}
