/* SPDX-License-Identifier: Apache-2.0 */
/**
 * First-boot LSP install orchestrator.
 *
 * Runs unawaited from `session_start`. The flow is:
 *
 *   1. Detect current state of Apex + LWC (local files vs. upstream latest).
 *   2. If everything is current and no actionable work remains → exit silent.
 *   3. If Windows → notify with manual instructions once per new version.
 *   4. Otherwise, present a single bundled confirm dialog that lists every
 *      component needing install or update and its size estimate.
 *      - user accepts → run installs sequentially, show working indicator
 *        and a final summary notification.
 *      - user declines → persist the declined version per component. We
 *        re-prompt automatically when upstream publishes something newer.
 *
 * Contract guarantees:
 *   - Never blocks session_start.
 *   - Never prompts when nothing would change.
 *   - Exactly one confirm per session (the orchestrator short-circuits
 *     if it has already prompted this session).
 *   - Safe on ctx.hasUI = false (exits silent, e.g. `pi -p`).
 */
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ExecFn } from "../../../../lib/common/sf-environment/detect.ts";
import { detectInstallReport } from "./detect.ts";
import { fetchLatestApex } from "./versioning.ts";
import { installApex, installLwc } from "./installer.ts";
import { readLspInstallState, recordComponentDecision } from "./state.ts";
import { doctorLsp } from "../lsp-client.ts";
import type {
  ComponentDecision,
  ComponentInstallResult,
  ComponentReport,
  InstallReport,
  LspComponentId,
  LspInstallState,
} from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Module-scoped guard — ensures we prompt at most once per session.
// -------------------------------------------------------------------------------------------------

let promptedThisSession = false;

/** Reset between sessions so reloads get a fresh chance to prompt. */
export function resetOrchestratorSession(): void {
  promptedThisSession = false;
}

// -------------------------------------------------------------------------------------------------
// Entry point — called unawaited from session_start
// -------------------------------------------------------------------------------------------------

export interface OrchestratorOptions {
  /** Override platform (tests). */
  platform?: NodeJS.Platform;
  /** Called after any doctor-relevant change so sf-devbar repaints. */
  onInstallCompleted?(results: ComponentInstallResult[]): void;
  /** Working directory for doctor discovery (defaults to ctx.cwd). */
  cwd?: string;
}

export async function maybePromptLspInstall(
  ctx: ExtensionContext,
  exec: ExecFn,
  options: OrchestratorOptions = {},
): Promise<void> {
  if (!ctx.hasUI) return;
  if (promptedThisSession) return;

  // Pull the full sf-lsp discovery chain (env / .pi / managed / VS Code
  // / PATH) so we can honor externally-provided LSP servers. Without
  // this, users who already have the Salesforce VS Code extensions see
  // green dots in the top bar but still get an "install" prompt for
  // servers they don't actually need.
  const cwd = options.cwd ?? ctx.cwd;
  let doctor;
  try {
    doctor = await doctorLsp(cwd);
  } catch {
    doctor = undefined;
  }

  let report: InstallReport;
  try {
    report = await detectInstallReport(exec, { platform: options.platform, doctor });
  } catch {
    // Detection is defensive; a failure means we can't prompt intelligently.
    return;
  }

  if (!report.hasActionable) return;

  const state = readLspInstallState();
  const actionable = pendingComponents(report, state);
  if (actionable.length === 0) return;

  promptedThisSession = true;

  if (report.platformManual || options.platform === "win32") {
    ctx.ui.notify(renderWindowsInstructions(actionable), "info");
    for (const component of actionable) {
      recordComponentDecision(component.id, {
        action: "decline",
        declinedVersion: component.latestVersion,
        at: new Date().toISOString(),
      });
    }
    return;
  }

  const title = "Install Salesforce LSP servers?";
  const body = renderPromptBody(actionable);

  let proceed: boolean;
  try {
    proceed = await ctx.ui.confirm(title, body);
  } catch {
    // Dialog cancelled (session teardown, theme reload). Treat as no
    // decision so we can re-prompt next session.
    promptedThisSession = false;
    return;
  }

  const at = new Date().toISOString();
  if (!proceed) {
    for (const component of actionable) {
      recordComponentDecision(component.id, {
        action: "decline",
        declinedVersion: component.latestVersion,
        at,
      });
    }
    ctx.ui.notify("sf-lsp: install declined. Run /sf-lsp install to review again.", "info");
    return;
  }

  // User accepted. Fire the installs sequentially so we can push / pop the
  // working indicator cleanly and report per-component outcomes.
  const results = await runInstalls(ctx, exec, actionable);
  for (const component of actionable) {
    const result = results.find((r) => r.id === component.id);
    recordComponentDecision(component.id, {
      action: "install",
      acceptedVersion: result?.installedVersion ?? component.latestVersion,
      at,
    });
  }

  ctx.ui.notify(renderResultSummary(results, report), summarizeSeverity(results));
  options.onInstallCompleted?.(results);
}

// -------------------------------------------------------------------------------------------------
// Decision filtering
// -------------------------------------------------------------------------------------------------

/**
 * Return components that actually need a prompt right now.
 *
 * Skip rules:
 *   - state === "current" → never needs action.
 *   - state === "manual"  → handled via Windows branch in the caller.
 *   - state === "unknown" → upstream lookup failed; stay silent.
 *   - user previously declined AND declinedVersion === latestVersion → skip
 *     (re-prompt only when upstream publishes something newer).
 */
function pendingComponents(report: InstallReport, state: LspInstallState): ComponentReport[] {
  return report.components.filter((component) => {
    if (component.id === "java") return false;
    if (component.state !== "missing" && component.state !== "outdated") return false;

    const decision = state.decisions[component.id];
    if (decision?.action === "decline") {
      const latest = component.latestVersion;
      if (latest && decision.declinedVersion === latest) {
        // Re-prompt only when upstream bumps past the declined version.
        return false;
      }
    }
    return true;
  });
}

// -------------------------------------------------------------------------------------------------
// Install runner
// -------------------------------------------------------------------------------------------------

async function runInstalls(
  ctx: ExtensionContext,
  exec: ExecFn,
  components: ComponentReport[],
): Promise<ComponentInstallResult[]> {
  const results: ComponentInstallResult[] = [];

  for (const component of components) {
    pushIndicator(ctx, component.label);
    try {
      if (component.id === "apex") {
        // Re-resolve the vsix URL at install time. It's bound to the
        // latest version we just fetched in detect() but the upstream
        // redirect can change between detect and install, so a fresh
        // lookup is cheap insurance.
        const upstream = await fetchLatestApex();
        if (!upstream) {
          results.push({
            id: "apex",
            ok: false,
            message: "Could not resolve Apex vsix download URL (marketplace unreachable).",
          });
          continue;
        }
        results.push(await installApex(exec, upstream));
      } else if (component.id === "lwc") {
        if (!component.latestVersion) {
          results.push({
            id: "lwc",
            ok: false,
            message: "Could not resolve lwc-language-server version (npm registry unreachable).",
          });
          continue;
        }
        results.push(await installLwc(exec, { version: component.latestVersion }));
      }
    } finally {
      popIndicator(ctx);
    }
  }

  return results;
}

// -------------------------------------------------------------------------------------------------
// Working-indicator helpers (local to the installer — separate from the
// per-check indicator in `working-indicator.ts` to avoid muddying that
// file's concerns).
// -------------------------------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function pushIndicator(ctx: ExtensionContext, label: string): void {
  if (!ctx.hasUI) return;
  const theme = ctx.ui.theme;
  const frames = SPINNER_FRAMES.map(
    (frame) => `${theme.fg("accent", frame)} ${theme.fg("dim", `Installing ${label}…`)}`,
  );
  try {
    ctx.ui.setWorkingIndicator({ frames, intervalMs: 80 });
  } catch {
    // older pi builds may lack WorkingIndicatorOptions
  }
}

function popIndicator(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  try {
    ctx.ui.setWorkingIndicator();
  } catch {
    // ignore
  }
}

// -------------------------------------------------------------------------------------------------
// Rendering
// -------------------------------------------------------------------------------------------------

export function renderPromptBody(components: ComponentReport[]): string {
  const rows = components.map((c) => {
    const label = c.label;
    if (c.state === "missing") {
      const size = c.id === "apex" ? " (~40 MB)" : c.id === "lwc" ? " (~15 MB)" : "";
      return `  • ${label} — not installed, upstream ${c.latestVersion ?? "(unknown)"}${size}`;
    }
    if (c.state === "outdated") {
      return `  • ${label} — ${c.installedVersion ?? "unknown"} → ${c.latestVersion ?? "latest"} (update available)`;
    }
    return `  • ${label}`;
  });

  return [
    "sf-pi wants to keep these Salesforce LSP servers current so Apex and",
    "LWC diagnostics work out of the box. Downloads land under",
    "  ~/.pi/agent/lsp/",
    "(no sudo, no global npm, no PATH changes).",
    "",
    ...rows,
    "",
    "The install runs in the background. You can revisit this anytime with",
    "  /sf-lsp install",
  ].join("\n");
}

export function renderWindowsInstructions(components: ComponentReport[]): string {
  const lines = [
    "sf-pi: auto-install of LSP servers is not supported on Windows.",
    "Install manually:",
    "",
  ];

  for (const component of components) {
    if (component.id === "apex") {
      lines.push(
        "  Apex Language Server",
        "    Install the Salesforce Apex VS Code extension (it bundles the jar),",
        "    or download the vsix, unzip, and copy `extension/dist/apex-jorje-lsp.jar`",
        "    into `%USERPROFILE%\\.pi\\agent\\lsp\\apex\\`.",
        "    Marketplace: https://marketplace.visualstudio.com/items?itemName=salesforce.salesforcedx-vscode-apex",
        "    Requires Java 11+ on PATH.",
        "",
      );
    }
    if (component.id === "lwc") {
      lines.push("  LWC Language Server", "    npm install -g @salesforce/lwc-language-server", "");
    }
  }

  lines.push(
    "After installing, run /sf-lsp doctor to verify discovery.",
    "Mac / Linux / WSL users can use the built-in auto-install flow.",
  );
  return lines.join("\n");
}

export function renderResultSummary(
  results: ComponentInstallResult[],
  report: InstallReport,
): string {
  const lines = ["sf-pi: LSP install summary", ""];
  for (const result of results) {
    const icon = result.ok ? "✓" : "✗";
    lines.push(`  ${icon} ${labelFor(result.id)}: ${result.message}`);
  }

  const java = report.components.find((c) => c.id === "java");
  if (java && java.state !== "current") {
    lines.push(
      "",
      `  ⚠ ${java.label}: ${java.detail ?? "install manually to enable Apex diagnostics."}`,
    );
  }

  lines.push("", "Top-bar LSP status will refresh shortly. Run /sf-lsp doctor to re-probe.");
  return lines.join("\n");
}

function summarizeSeverity(results: ComponentInstallResult[]): "info" | "warning" {
  return results.every((r) => r.ok) ? "info" : "warning";
}

function labelFor(id: LspComponentId): string {
  switch (id) {
    case "apex":
      return "Apex Language Server";
    case "lwc":
      return "LWC Language Server";
    case "java":
      return "Java 11+";
  }
}

// Re-export so index.ts can render the status command without a second
// import path.
export type { ComponentDecision };
