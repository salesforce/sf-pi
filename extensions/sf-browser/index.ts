/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-browser behavior contract
 *
 * SF Browser is an experimental developer-assistive layer for Salesforce UI
 * last-mile work that Salesforce APIs cannot cover. It keeps agent-browser as
 * the lazy CDP runtime and exposes only the hot-path browser loop as typed Pi
 * tools. It does not claim a stable Salesforce UI automation contract.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|------------------------------------------------------------
 *   extension load         | Register /sf-browser; tool registration is lazy by enablement
 *   session_start/reload   | Register hot-path tools when enabled
 *   resources_discover     | Contribute progressive sf-browser skill when enabled
 *   /sf-browser (no args)  | Open cache-first command panel; no runtime probes
 *   /sf-browser doctor     | Explicitly check agent-browser installation
 *   sf_browser_* tools     | Invoke agent-browser only after explicit tool intent
 */
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { type CommandPanelState, openCommandPanel } from "../../lib/common/command-panel.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  type SfPiCommandAction,
  formatHelpFromActions,
  getCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  buildToggleExtensionAction,
  isLifecycleToggleAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { isSfPiExtensionEnabled } from "../../lib/common/sf-pi-extension-state.ts";
import { getCachedSfEnvironment } from "../../lib/common/sf-environment/shared-runtime.ts";
import { checkAgentBrowser } from "./lib/agent-browser.ts";
import {
  getEvidenceDir,
  getEvidenceIndexPath,
  getLatestEvidencePointerPath,
  latestEvidenceCaptures,
} from "./lib/artifacts.ts";
import { buildEvidenceReport } from "./lib/evidence-report.ts";
import { COMMAND_NAME, EXTENSION_ID, SF_BROWSER_SESSION } from "./lib/constants.ts";
import { SALESFORCE_BROWSER_GUIDANCE } from "./lib/guidance.ts";
import { formatKnownSetupDestinations, resolveSetupDestination } from "./lib/setup-destinations.ts";
import { captureEvidence, openOrgInAgentBrowser } from "./lib/operations.ts";
import { registerSfBrowserCaptureEvidenceTool } from "./lib/sf_browser_capture_evidence-tool.ts";
import { registerSfBrowserClickTool } from "./lib/sf_browser_click-tool.ts";
import { registerSfBrowserFillTool } from "./lib/sf_browser_fill-tool.ts";
import { registerSfBrowserOpenOrgTool } from "./lib/sf_browser_open_org-tool.ts";
import { registerSfBrowserPressTool } from "./lib/sf_browser_press-tool.ts";
import { registerSfBrowserResolvePathTool } from "./lib/sf_browser_resolve_path-tool.ts";
import { registerSfBrowserSelectTool } from "./lib/sf_browser_select-tool.ts";
import { registerSfBrowserSnapshotTool } from "./lib/sf_browser_snapshot-tool.ts";
import { registerSfBrowserWaitTool } from "./lib/sf_browser_wait-tool.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default function sfBrowser(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, "sf-browser")) return;

  let toolsRegistered = false;

  function ensureToolsRegistered(): void {
    if (toolsRegistered) return;
    registerSfBrowserOpenOrgTool(pi);
    registerSfBrowserSnapshotTool(pi);
    registerSfBrowserClickTool(pi);
    registerSfBrowserFillTool(pi);
    registerSfBrowserSelectTool(pi);
    registerSfBrowserPressTool(pi);
    registerSfBrowserWaitTool(pi);
    registerSfBrowserCaptureEvidenceTool(pi);
    registerSfBrowserResolvePathTool(pi);
    toolsRegistered = true;
  }

  pi.on("session_start", (event, ctx) => {
    if (event.reason === "reload") toolsRegistered = false;
    if (isSfPiExtensionEnabled(ctx.cwd, EXTENSION_ID)) ensureToolsRegistered();
  });
  pi.on("session_shutdown", () => {
    toolsRegistered = false;
  });
  pi.on("resources_discover", (event) => {
    if (!isSfPiExtensionEnabled(event.cwd, EXTENSION_ID)) return;
    if (event.reason === "reload") {
      toolsRegistered = false;
      ensureToolsRegistered();
    }
    return { skillPaths: [path.join(__dirname, "skills")] };
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Browser — Salesforce UI last-mile automation with agent-browser",
    getArgumentCompletions: (prefix: string) =>
      getCompletionsFromActions(SF_BROWSER_ACTIONS, prefix.trim().split(/\s+/).at(-1) ?? "", {
        excludeValues: ["close", "lifecycle.toggle"],
      }),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, () => handleCommand(pi, ctx, args || ""));
    },
  });
}

type SfBrowserAction =
  | "status"
  | "open"
  | "open-setup"
  | "screenshot"
  | "evidence"
  | "doctor"
  | "guidance"
  | "help"
  | "close"
  | LifecycleActionId;

const SF_BROWSER_ACTIONS: SfPiCommandAction<SfBrowserAction>[] = [
  {
    value: "open",
    label: "Open target org or setup destination",
    description:
      "Open the active Salesforce target org, a curated Setup Destination, or an explicit Salesforce path in the shared agent-browser session.",
    group: "Browser",
  },
  {
    value: "open-setup",
    label: "Open Setup home",
    description: "Open /lightning/setup/SetupOneHome/home in the shared agent-browser session.",
    group: "Browser",
    aliases: ["setup"],
  },
  {
    value: "screenshot",
    label: "Capture evidence",
    description:
      "Capture Browser Evidence in thumbnail mode and save the full screenshot privately.",
    group: "Evidence",
  },
  {
    value: "evidence",
    label: "Show evidence for this session",
    description:
      "List the current pi session's Browser Evidence directory, latest pointer, and recent captures with audit status.",
    group: "Evidence",
  },
  {
    value: "doctor",
    label: "Check agent-browser install",
    description:
      "Run an explicit, lazy agent-browser version check and print install guidance if missing.",
    group: "Diagnostics",
  },
  {
    value: "status",
    label: "Show status",
    description: "Show cache-first SF Browser status without probing agent-browser.",
    group: "Diagnostics",
  },
  {
    value: "guidance",
    label: "Show Salesforce browser guidance",
    description: "Print the Salesforce Browser Contract for successful first-shot UI automation.",
    group: "Reference",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and the SF Browser v1 scope.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: LIFECYCLE_GROUP,
  },
];

function buildSfBrowserActions(cwd: string): SfPiCommandAction<SfBrowserAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: EXTENSION_ID, cwd });
  return toggle ? [...SF_BROWSER_ACTIONS, toggle] : SF_BROWSER_ACTIONS;
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  rawArgs: string,
): Promise<void> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  if (args.length === 0 && ctx.hasUI) {
    await handlePanel(pi, ctx);
    return;
  }

  const resolved =
    args.length === 0 ? "status" : (resolveAction(SF_BROWSER_ACTIONS, args[0] ?? "") ?? args[0]);
  await handleAction(pi, ctx, resolved, args.slice(1), false);
}

async function handlePanel(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const state: CommandPanelState<SfBrowserAction> = {};
  await openCommandPanel(ctx, {
    title: "🌐 SF Browser — status & controls",
    subtitle: "Salesforce UI last-mile automation with agent-browser.",
    statusLines: () => buildStatusLines(ctx),
    actions: () => buildSfBrowserActions(ctx.cwd),
    closeValue: "close",
    state,
    onAction: (action) => handleAction(pi, ctx, action, [], true),
    closeBeforeAction: isLifecycleToggleAction,
  });
}

async function handleAction(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  action: SfBrowserAction | string,
  args: string[],
  fromPanel: boolean,
): Promise<void> {
  if (action === "lifecycle.toggle") {
    await performToggleExtension(ctx, EXTENSION_ID);
    return;
  }
  if (action === "help") {
    await emitOutput(ctx, "SF Browser help", buildHelpText(), "info", fromPanel);
    return;
  }
  if (action === "guidance") {
    await emitOutput(ctx, "SF Browser guidance", SALESFORCE_BROWSER_GUIDANCE, "info", fromPanel);
    return;
  }
  if (action === "status") {
    await emitOutput(ctx, "SF Browser status", buildStatusLines(ctx).join("\n"), "info", fromPanel);
    return;
  }
  if (action === "evidence") {
    await emitOutput(
      ctx,
      "SF Browser evidence",
      buildEvidenceReport(ctx.sessionManager.getSessionId(), parseEvidenceLimit(args)),
      "info",
      fromPanel,
    );
    return;
  }
  if (action === "doctor") {
    await emitOutput(
      ctx,
      "SF Browser doctor",
      await checkAgentBrowser(pi, ctx.cwd),
      "info",
      fromPanel,
    );
    return;
  }
  if (action === "open" || action === "open-setup") {
    const rawTarget = action === "open-setup" ? "setup-home" : args.join(" ") || undefined;
    const setupPath =
      rawTarget && !rawTarget.startsWith("/") ? resolveSetupDestination(rawTarget) : undefined;
    const result = await openOrgInAgentBrowser(pi, ctx, {
      ...(setupPath ? { setup: rawTarget } : { path: rawTarget }),
      purpose: fromPanel ? "Opened from /sf-browser panel" : "Opened from /sf-browser command",
    });
    await emitOutput(ctx, "SF Browser open", result.text, "success", fromPanel);
    return;
  }
  if (action === "screenshot") {
    const result = await captureEvidence(pi, ctx, {
      label: args.join(" ") || "panel-capture",
      imageMode: "thumbnail",
    });
    const text =
      result.content.find((part) => part.type === "text")?.text ?? "Captured Browser Evidence.";
    await emitOutput(ctx, "SF Browser evidence", text, "success", fromPanel);
    return;
  }

  await emitOutput(
    ctx,
    "SF Browser — unknown subcommand",
    `Unknown /${COMMAND_NAME} subcommand: ${String(action)}`,
    "warning",
    fromPanel,
  );
}

function parseEvidenceLimit(args: string[]): number {
  const parsed = Number(args[0]);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(50, Math.max(1, Math.floor(parsed)));
}

function buildStatusLines(ctx: ExtensionCommandContext): string[] {
  const env = getCachedSfEnvironment(ctx.cwd);
  const sessionId = ctx.sessionManager.getSessionId();
  const recent = latestEvidenceCaptures(3, sessionId);
  return [
    "• Runtime        agent-browser not checked (run doctor to probe)",
    `• Browser       ${SF_BROWSER_SESSION}`,
    `• Pi session    ${sessionId}`,
    `• Target org     ${env?.config.targetOrg ?? env?.org.alias ?? "not cached"}`,
    "• Evidence mode  thumbnail by default; use artifact for batches",
    `• Artifacts      ${getEvidenceDir(sessionId)}`,
    `• Index          ${getEvidenceIndexPath(sessionId)}`,
    `• Latest pointer ${getLatestEvidencePointerPath()}`,
    recent.length
      ? `• Recent         ${recent.map((item) => `#${item.id} ${item.label}${item.setupAuditTrail ? ` (${item.setupAuditTrail.status})` : ""}`).join(", ")}`
      : "• Recent         none",
  ];
}

function buildHelpText(): string {
  return [
    "SF Browser is an experimental developer-assistive surface for Salesforce UI last-mile work; it does not imply a stable Salesforce UI automation contract.",
    "",
    formatHelpFromActions(SF_BROWSER_ACTIONS, COMMAND_NAME),
    "",
    `Setup destinations: ${formatKnownSetupDestinations()}`,
    "",
    "Agent tools:",
    "  sf_browser_open_org          Open target org/path or curated setup destination in the shared agent-browser session.",
    "  sf_browser_snapshot          Capture compact interactive refs for reasoning.",
    "  sf_browser_click             Click a ref from the latest snapshot.",
    "  sf_browser_fill              Fill a ref from the latest snapshot.",
    "  sf_browser_select            Select values in Salesforce select/listbox refs.",
    "  sf_browser_press             Press keyboard keys such as Enter or Escape.",
    "  sf_browser_wait              Wait for expected text, URL, load state, or last-resort ms.",
    "  sf_browser_capture_evidence  Capture private screenshot evidence; thumbnail by default.",
    "  sf_browser_resolve_path       Resolve structured Salesforce routes and setup destinations without opening the browser.",
    "",
    "Evidence commands:",
    "  /sf-browser evidence [limit]  List session-scoped Browser Evidence captures and artifact paths.",
    "",
    SALESFORCE_BROWSER_GUIDANCE,
  ].join("\n");
}

async function emitOutput(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: InfoPanelSeverity,
  fromPanel: boolean,
): Promise<void> {
  if (fromPanel && ctx.hasUI) {
    await openInfoPanel(ctx, { title, body, severity });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }
  console.info(body);
}
