/* SPDX-License-Identifier: Apache-2.0 */
/** TUI-first human annotation for Pi replies and explicit local text artifacts. */
import { spawnSync } from "node:child_process";
import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getFirstTokenCompletions } from "../../lib/common/command-actions.ts";
import { registerExtensionDoctor } from "../../lib/common/doctor/registry.ts";
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { registerManagerDetailActions } from "../../lib/common/manager-actions.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import {
  detectPlannotatorRuntime,
  writeCachedPlannotatorRuntime,
  type PlannotatorRuntimeStatus,
} from "../../lib/common/plannotator-runtime.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  cleanupReviewSnapshot,
  createReviewSnapshot,
  fileReviewSnapshot,
  getLastAssistantReview,
  listReviewDataDirs,
  reviewSourceChanged,
} from "./lib/review.ts";
import { buildPlanReviewDoctor, renderPlanReviewDoctor } from "./lib/doctor.ts";
import { formatHerdrReviewFeedback, REVIEW_ENTRY_TYPE } from "./lib/feedback.ts";
import { installManagedTui } from "./lib/installer.ts";
import { managedTuiPath, TUI_VERSION } from "../../lib/common/plannotator-release.ts";

const NAME = "sf-planreview";
const ACTIONS = [
  { value: "last", label: "Review last reply", description: "Annotate the last Pi reply." },
  { value: "status", label: "Show status", description: "Show TUI and Herdr readiness." },
  { value: "doctor", label: "Run doctor", description: "Check which review route is available." },
  {
    value: "setup",
    label: "Set up review",
    description:
      "Install a verified standalone TUI or the official Herdr plugin after confirmation.",
  },
  {
    value: "cleanup",
    label: "Clear saved reviews",
    description: "Remove private snapshots after explicit confirmation.",
  },
  { value: "help", label: "Show help", description: "Show review commands and boundaries." },
] as const;

export default function sfPlannotator(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, "sf-planreview")) return;

  const unregisterDoctor = registerExtensionDoctor(NAME, async (cwd, signal) => {
    const exec = async (command: string, args: string[], options?: { timeout?: number }) => {
      const result = await pi.exec(command, args, {
        cwd,
        signal,
        timeout: Math.min(options?.timeout ?? 2_000, 2_000),
      });
      return { stdout: result.stdout, stderr: result.stderr, code: result.code };
    };
    return buildPlanReviewDoctor(await detectPlannotatorRuntime(exec), listReviewDataDirs().length);
  });
  pi.on("session_shutdown", unregisterDoctor);
  pi.on("input", (event, ctx) => {
    const feedback = formatHerdrReviewFeedback(event.text, ctx.sessionManager.getBranch());
    if (feedback) return { action: "transform", text: feedback };
  });

  pi.registerCommand(NAME, {
    description: "Review Pi replies and text files with Plannotator TUI",
    getArgumentCompletions: (prefix) => getFirstTokenCompletions(ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, NAME, async () => {
        const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
        if (!action && ctx.hasUI) {
          const opened = await openExtensionInManager(pi, ctx, {
            extensionId: NAME,
            view: "detail",
            actions: ACTIONS.map((item) => ({
              id: item.value,
              label: item.label,
              description: item.description,
              run: (panelCtx) => handleAction(pi, item.value, "", panelCtx),
              closeBeforeRun:
                item.value === "setup" ||
                item.value === "last" ||
                item.value === "cleanup" ||
                item.value === "doctor",
            })),
          });
          if (!opened)
            ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-planreview help.", "warning");
          return;
        }
        await handleAction(pi, action ?? "status", rest.join(" "), ctx);
      });
    },
  });
  registerManagerDetailActions(
    pi,
    NAME,
    ACTIONS.map((item) => ({
      id: item.value,
      label: item.label,
      description: item.description,
      run: (ctx) => handleAction(pi, item.value, "", ctx),
      closeBeforeRun:
        item.value === "setup" ||
        item.value === "last" ||
        item.value === "cleanup" ||
        item.value === "doctor",
    })),
  );
}

async function handleAction(
  pi: ExtensionAPI,
  action: string,
  argument: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (action === "help") {
    emit(
      ctx,
      "Usage: /sf-planreview [last|file <path>|status|doctor|setup [tui|herdr]|cleanup|help]. Hunk owns code diffs.",
    );
    return;
  }
  if (
    action !== "last" &&
    action !== "file" &&
    action !== "status" &&
    action !== "doctor" &&
    action !== "setup" &&
    action !== "cleanup"
  ) {
    emit(ctx, `I don't recognize that review action. Try /sf-planreview help.`);
    return;
  }
  if (action === "cleanup") {
    const dirs = listReviewDataDirs();
    if (!dirs.length) {
      emit(ctx, "No private review snapshots to clear.");
      return;
    }
    if (!ctx.hasUI) {
      emit(
        ctx,
        "Cleanup requires interactive confirmation. Run /sf-planreview cleanup in Pi's terminal.",
      );
      return;
    }
    const confirmed = await ctx.ui.confirm(
      "Clear private plan reviews?",
      `Delete ${dirs.length} saved review(s) and their annotations? Close any open Herdr reviews first. This cannot be undone.`,
    );
    if (!confirmed) return;
    for (const dir of dirs) cleanupReviewSnapshot({ dataDir: path.join(dir, "data") });
    emit(ctx, `Cleared ${dirs.length} private review(s).`);
    return;
  }
  const answer = action === "last" ? getLastAssistantReview(ctx.sessionManager.getBranch()) : null;
  if (action === "last" && !answer) {
    emit(
      ctx,
      "Nothing to review yet. Ask Pi to draft a plan or reply, then try /sf-planreview last.",
    );
    return;
  }
  if (action === "file" && !argument.trim()) {
    emit(ctx, "Choose a text file to review: /sf-planreview file <path>.");
    return;
  }
  const runtime = await detectPlannotatorRuntime(buildExecFn(pi, ctx.cwd));
  writeCachedPlannotatorRuntime(runtime);
  if (action === "status") {
    emit(ctx, renderStatus(runtime));
    return;
  }
  if (action === "doctor") {
    const report = buildPlanReviewDoctor(runtime, listReviewDataDirs().length);
    const body = renderPlanReviewDoctor(report);
    if (ctx.hasUI)
      await openInfoPanel(ctx, {
        title: "SF Plan Review doctor",
        body,
        severity: report.checks.some((check) => check.severity === "error") ? "warning" : "info",
      });
    else console.info(body);
    return;
  }
  if (action === "setup") {
    await setupReviewRuntime(pi, ctx, runtime, argument);
    return;
  }
  if (!ctx.hasUI || ctx.mode !== "tui") {
    throw new Error("Plannotator TUI reviews require an interactive Pi terminal.");
  }
  if (!runtime.installed) {
    emit(
      ctx,
      "Plannotator TUI isn't installed yet. Run /sf-planreview setup to choose an official TUI install.",
    );
    return;
  }
  let source: {
    file: string;
    dataDir: string;
    label: string;
    sourcePath?: string;
    sourceDigest?: string;
  };
  if (answer) {
    source = { ...createReviewSnapshot(answer.text, "reply.md"), label: `reply ${answer.entryId}` };
  } else {
    try {
      source = fileReviewSnapshot(ctx.cwd, argument);
    } catch (error) {
      const missing = error instanceof Error && "code" in error && error.code === "ENOENT";
      emit(
        ctx,
        missing
          ? "I couldn't find that file. Check its path and try /sf-planreview file <path> again."
          : error instanceof Error
            ? error.message
            : "I couldn't open that file for review.",
      );
      return;
    }
  }
  const pane = process.env.HERDR_ENV === "1" ? process.env.HERDR_PANE_ID : undefined;
  if (pane && runtime.herdrReady) {
    const result = await pi.exec(
      "herdr",
      [
        "plugin",
        "pane",
        "open",
        "--plugin",
        "annotate",
        "--entrypoint",
        "doc",
        "--placement",
        "split",
        "--direction",
        "right",
        "--target-pane",
        pane,
        "--focus",
        "--cwd",
        ctx.cwd,
        "--env",
        `PLANNOTATOR_TUI_FILE=${source.file}`,
        "--env",
        `PLANNOTATOR_TUI_DELIVER_TO=${pane}`,
        "--env",
        `PLANNOTATOR_DATA_DIR=${source.dataDir}`,
      ],
      { cwd: ctx.cwd, timeout: 10_000 },
    );
    if (result.code !== 0) {
      cleanupReviewSnapshot(source);
      throw new Error(
        "Herdr Annotate could not open the review pane. Run /sf-planreview doctor for help.",
      );
    }
    const opened = JSON.parse(result.stdout) as {
      result?: { plugin_pane?: { pane?: { pane_id?: string } } };
    };
    if (!opened.result?.plugin_pane?.pane?.pane_id) {
      throw new Error("Herdr did not confirm that the review pane opened.");
    }
    pi.appendEntry(REVIEW_ENTRY_TYPE, {
      reviewFile: path.basename(source.file),
      sourcePath: source.sourcePath,
      sourceDigest: source.sourceDigest,
      label: source.label,
    });
    emit(
      ctx,
      "Plannotator review opened in Herdr. Send returns feedback to this Pi pane; do not send it twice.",
    );
    return;
  }
  if (!runtime.binaryPath) throw new Error("No standalone Plannotator TUI is available.");
  const binary = runtime.binaryPath;
  const environment = { ...process.env, PLANNOTATOR_DATA_DIR: source.dataDir };
  const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _keys, done) => {
    let code: number | null = null;
    tui.stop();
    try {
      code = spawnSync(binary, [source.file], { stdio: "inherit", env: environment }).status;
    } finally {
      tui.start();
      tui.requestRender(true);
      done(code);
    }
    return { render: () => [], invalidate: () => {} };
  });
  if (exitCode !== 0) throw new Error("Plannotator TUI exited without completing the review.");
  const exported = spawnSync(binary, ["--export", source.file], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 1024 * 1024,
  });
  if (exported.status !== 0) throw new Error("Could not export Plannotator annotations.");
  const feedback = exported.stdout.trim();
  if (!feedback) {
    cleanupReviewSnapshot(source);
    emit(ctx, "Review closed without annotations; nothing was sent to Pi.");
    return;
  }
  const confirmed = await ctx.ui.confirm(
    "Send Plannotator feedback to Pi?",
    feedback.slice(0, 2_000),
  );
  if (!confirmed) {
    emit(ctx, "Annotations kept locally; nothing was sent to Pi.");
    return;
  }
  const stale = reviewSourceChanged(source);
  pi.sendUserMessage(
    `Review of ${source.label}${stale ? " (the source changed since review began; recheck before applying feedback)" : ""}:\n\n${feedback}`,
    { deliverAs: "followUp" },
  );
  cleanupReviewSnapshot(source);
}

function renderStatus(status: PlannotatorRuntimeStatus): string {
  if (!status.installed) {
    const broken =
      status.managedState === "damaged" ||
      status.herdrState === "broken" ||
      status.herdrState === "unverified";
    return broken
      ? "SF Plan Review: needs repair · /sf-planreview doctor"
      : "SF Plan Review: not installed · /sf-planreview setup";
  }
  const route = status.herdrReady
    ? "Herdr Annotate Full"
    : status.managedState === "verified"
      ? "managed TUI"
      : "standalone TUI";
  return `SF Plan Review: installed${status.version ? ` v${status.version}` : ""} · ${route}`;
}

const HERDR_PLUGIN_REF = "1bc258353f0a7af0781493e1c1ffca09b71666bc";

async function setupReviewRuntime(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  status: PlannotatorRuntimeStatus,
  requested: string,
): Promise<void> {
  if (!ctx.hasUI) {
    emit(
      ctx,
      "Setup needs an interactive confirmation. Run /sf-planreview setup in Pi's terminal.",
    );
    return;
  }
  const target =
    requested === "tui" || requested === "herdr"
      ? requested
      : requested
        ? undefined
        : await ctx.ui.select("Set up Plannotator", ["Standalone TUI", "Herdr Annotate Full"]);
  if (!target) {
    if (requested)
      emit(ctx, "Choose a setup target: /sf-planreview setup tui or /sf-planreview setup herdr.");
    return;
  }
  if (target === "tui" || target === "Standalone TUI") {
    if (status.managedState === "unsupported") {
      emit(
        ctx,
        "There isn't a managed TUI build for this platform. See the official Plannotator TUI releases for manual installation.",
      );
      return;
    }
    if (status.managedState === "verified") {
      emit(ctx, `Plannotator TUI v${TUI_VERSION} is already installed and verified.`);
      return;
    }
    const approved = await ctx.ui.confirm(
      "Install standalone Plannotator TUI?",
      `Download the pinned v${TUI_VERSION} binary from the official public release, verify its SHA-256, and store it at ${managedTuiPath()}. No project or org files change.`,
    );
    if (!approved) return;
    const result = await installManagedTui();
    if (!result.ok) {
      emit(ctx, result.message);
      return;
    }
    const refreshed = await detectPlannotatorRuntime(buildExecFn(pi, ctx.cwd));
    writeCachedPlannotatorRuntime(refreshed);
    emit(
      ctx,
      refreshed.managedState === "verified"
        ? result.message
        : "Installation completed but the TUI did not pass its runtime check. Run /sf-planreview doctor.",
    );
    return;
  }
  if (status.herdrState === "ready") {
    emit(ctx, "Herdr Annotate Full is already installed and ready.");
    return;
  }
  if (status.herdrState === "unverified") {
    emit(ctx, "Another Annotate plugin is installed. Inspect it in Herdr before replacing it.");
    return;
  }
  if (status.herdrState === "unavailable") {
    emit(ctx, "Herdr is not available. Install Herdr first, or choose /sf-planreview setup tui.");
    return;
  }
  const pluginSource =
    process.platform === "win32"
      ? "plannotator/herdr-annotate/windows-full"
      : "plannotator/herdr-annotate";
  const approved = await ctx.ui.confirm(
    "Install Herdr Annotate Full?",
    `Herdr will install the official ${pluginSource} plugin pinned at commit ${HERDR_PLUGIN_REF}. This may replace an existing Lite or disabled plugin. The Windows Full variant is preview-only.`,
  );
  if (!approved) return;
  const result = await pi.exec(
    "herdr",
    ["plugin", "install", pluginSource, "--ref", HERDR_PLUGIN_REF, "-y"],
    { cwd: ctx.cwd, timeout: 120_000 },
  );
  const refreshed = await detectPlannotatorRuntime(buildExecFn(pi, ctx.cwd));
  writeCachedPlannotatorRuntime(refreshed);
  emit(
    ctx,
    result.code === 0 && refreshed.herdrState === "ready"
      ? "Herdr Annotate Full installed and verified. Optional keybindings remain user-controlled."
      : "Herdr Annotate could not be verified. Run /sf-planreview doctor for repair guidance.",
  );
}

function emit(ctx: ExtensionCommandContext, text: string): void {
  if (ctx.hasUI) ctx.ui.notify(text, "info");
  else console.info(text);
}
