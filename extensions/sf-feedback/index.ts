/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-feedback — guided public GitHub feedback for SF Pi.
 *
 * Provides:
 * - /sf-feedback: collect feedback, run sanitized diagnostics, preview, then
 *   create a GitHub issue or open a prefilled fallback URL.
 * - /sf-feedback diagnostics: print the diagnostics block without creating an
 *   issue.
 *
 * Safety contract:
 * - Never submits an issue without a final user confirmation.
 * - Redacts org aliases/URLs, emails, tokens, home-directory paths, and private
 *   non-GitHub remotes before preview or submission.
 * - Headless mode never creates an issue; it prints the issue body and URL.
 *
 * Behavior matrix:
 *
 *   Trigger                  | Condition                 | Result
 *   -------------------------|---------------------------|----------------------------------------
 *   /sf-feedback             | interactive + gh auth     | Prompt → preview → confirm → create
 *   /sf-feedback             | interactive, no gh auth   | Prompt → preview → open fallback URL
 *   /sf-feedback             | headless                  | Emit body + fallback URL only
 *   /sf-feedback diagnostics | any                       | Emit sanitized diagnostics
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { collectDiagnostics, type ExecFn } from "./lib/diagnostics.ts";
import { buildIssueUrl, createIssueWithGh, openUrl } from "./lib/github.ts";
import {
  buildDiagnosticsOnlyBody,
  buildIssueBody,
  labelForKind,
  normalizeIssueTitle,
} from "./lib/issue-template.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import {
  buildToggleExtensionAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../sf-pi-manager/lib/extension-toggle.ts";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import { sanitizeText } from "./lib/sanitize.ts";
import type { FeedbackDraft, IssueKind } from "./lib/types.ts";

const COMMAND_NAME = "sf-feedback";
const STATUS_KEY = "sf-feedback";

export default function sfFeedback(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-feedback")) return;

  pi.registerCommand(COMMAND_NAME, {
    description: "Create sanitized SF Pi feedback or bug reports on GitHub",
    getArgumentCompletions: (prefix: string) => {
      const current = prefix.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
      const options = ["bug", "feature", "setup", "feedback", "diagnostics", "help"];
      const matches = options
        .filter((option) => option.startsWith(current))
        .map((option) => ({ value: option, label: option }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const exec = buildExecFn(pi, ctx.cwd);
      if (!(args || "").trim() && ctx.hasUI) {
        await handleFeedbackPanel(pi, ctx, exec);
        return;
      }
      await handleCommand(pi, ctx, exec, args || "");
    },
  });
}

type FeedbackAction =
  | "bug"
  | "feature"
  | "setup"
  | "feedback"
  | "diagnostics"
  | "help"
  | "close"
  | LifecycleActionId;

const FEEDBACK_ACTIONS: CommandPanelAction<FeedbackAction>[] = [
  {
    value: "bug",
    label: "Report a bug",
    description: "Start a guided bug report with sanitized local diagnostics and final preview.",
    group: "Create issue",
  },
  {
    value: "feature",
    label: "Request a feature",
    description: "Start a guided feature request with sanitized diagnostics and final preview.",
    group: "Create issue",
  },
  {
    value: "setup",
    label: "Report setup issue",
    description: "Start a guided setup/install issue report with local runtime diagnostics.",
    group: "Create issue",
  },
  {
    value: "feedback",
    label: "General feedback",
    description: "Start a general feedback issue with diagnostics and a public-safe preview.",
    group: "Create issue",
  },
  {
    value: "diagnostics",
    label: "Copy diagnostics only",
    description:
      "Print the sanitized diagnostics block without opening or creating a GitHub issue.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and safety behavior.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: LIFECYCLE_GROUP,
  },
];

// Compose the live action list so the lifecycle toggle row reflects the
// current enablement state on every panel open.
function buildFeedbackActions(cwd: string): CommandPanelAction<FeedbackAction>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "sf-feedback", cwd });
  return toggle ? [...FEEDBACK_ACTIONS, toggle] : FEEDBACK_ACTIONS;
}

async function handleFeedbackPanel(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  exec: ExecFn,
): Promise<void> {
  const panelState: CommandPanelState<FeedbackAction> = {};
  await openCommandPanel(ctx, {
    title: "💬 SF Feedback — status & controls",
    subtitle: "Create public-safe feedback issues with sanitized diagnostics.",
    statusLines: [
      "✓ Privacy       diagnostics are sanitized before preview/submission",
      "✓ Confirmation  GitHub issue creation requires final approval",
      "• Headless      emits draft + URL only; never submits",
    ],
    actions: () => buildFeedbackActions(ctx.cwd),
    closeValue: "close",
    state: panelState,
    onAction: (action) => handleCommand(pi, ctx, exec, action),
  });
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  exec: ExecFn,
  rawArgs: string,
): Promise<void> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  const subcommand = args[0]?.toLowerCase();

  if (subcommand === "lifecycle.toggle") {
    await performToggleExtension(ctx, "sf-feedback");
    return;
  }

  if (subcommand === "help") {
    await emitCommandOutput(pi, ctx, "SF Feedback help", renderHelp(), "info");
    return;
  }

  ctx.ui.setStatus(STATUS_KEY, "Feedback: collecting diagnostics…");
  try {
    const diagnostics = await collectDiagnostics(exec, ctx.cwd);

    if (subcommand === "diagnostics") {
      await emitCommandOutput(
        pi,
        ctx,
        "SF Feedback diagnostics",
        buildDiagnosticsOnlyBody(diagnostics),
        "info",
      );
      return;
    }

    const requestedKind = parseIssueKind(subcommand);
    const hasExplicitKind = isIssueKind(subcommand);
    const draft = ctx.hasUI
      ? await promptForDraft(ctx, requestedKind, hasExplicitKind)
      : buildHeadlessDraft(requestedKind, args.slice(1).join(" "));
    if (!draft) {
      await emitCommandOutput(pi, ctx, "SF Feedback cancelled.", "No issue was created.", "info");
      return;
    }

    const title = normalizeIssueTitle(draft.kind, draft.title);
    const labels = labelForKind(draft.kind);
    const body = buildIssueBody(draft, diagnostics);
    const fallbackUrl = buildIssueUrl(title, body, labels);

    if (!ctx.hasUI) {
      await emitCommandOutput(
        pi,
        ctx,
        "SF Feedback issue draft",
        `${body}\n\nOpen this URL to create the issue:\n${fallbackUrl}`,
        "info",
      );
      return;
    }

    const preview = renderPreview(title, labels, body);
    const confirmed = await ctx.ui.confirm("Create GitHub issue?", preview);
    if (!confirmed) {
      await emitCommandOutput(
        pi,
        ctx,
        "SF Feedback cancelled.",
        `No issue was created. You can still open this prefilled URL:\n${fallbackUrl}`,
        "info",
      );
      return;
    }

    if (diagnostics.github.ghAvailable && diagnostics.github.authenticated) {
      ctx.ui.setStatus(STATUS_KEY, "Feedback: creating GitHub issue…");
      const result = await createIssueWithGh(exec, title, body, labels);
      if (result.ok) {
        await emitCommandOutput(
          pi,
          ctx,
          "SF Feedback issue created.",
          result.url ? `Created: ${result.url}` : result.detail,
          "info",
        );
        return;
      }

      await emitCommandOutput(
        pi,
        ctx,
        "Could not create issue with gh CLI.",
        `${result.detail}\n\nOpening a prefilled GitHub issue URL instead:\n${result.fallbackUrl}`,
        "warning",
      );
      await openUrl(exec, result.fallbackUrl);
      return;
    }

    await emitCommandOutput(
      pi,
      ctx,
      "Opening prefilled GitHub issue.",
      "GitHub CLI is unavailable or not authenticated, so SF Feedback will open a browser URL instead.",
      "info",
    );
    const opened = await openUrl(exec, fallbackUrl);
    if (!opened) {
      await emitCommandOutput(
        pi,
        ctx,
        "Open this GitHub issue URL manually.",
        fallbackUrl,
        "warning",
      );
    }
  } finally {
    ctx.ui.setStatus(STATUS_KEY, "");
  }
}

function buildExecFn(pi: ExtensionAPI, cwd: string): ExecFn {
  return async (command, args, options) => {
    const result = await pi.exec(command, args, {
      timeout: options?.timeout,
      cwd: options?.cwd ?? cwd,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: result.code };
  };
}

function parseIssueKind(value: string | undefined): IssueKind {
  return isIssueKind(value) ? value : "feedback";
}

function isIssueKind(value: string | undefined): value is IssueKind {
  return value === "bug" || value === "feature" || value === "setup" || value === "feedback";
}

async function promptForDraft(
  ctx: ExtensionCommandContext,
  initialKind: IssueKind,
  hasExplicitKind: boolean,
): Promise<FeedbackDraft | null> {
  let kind = initialKind;
  if (!hasExplicitKind) {
    const picked = await ctx.ui.select("What kind of SF Pi feedback is this?", [
      optionLabel("bug"),
      optionLabel("feature"),
      optionLabel("setup"),
      optionLabel("feedback"),
      "Cancel",
    ]);
    if (!picked || picked === "Cancel") return null;
    kind = parseIssueKind(picked.split(" ")[0]?.toLowerCase());
  }
  const title = await ctx.ui.input("Short GitHub issue title", "");
  if (title == null) return null;

  const summary = await ctx.ui.input("What happened? Include the important details.", "");
  if (summary == null) return null;

  const expected = await ctx.ui.input("What did you expect instead?", "");
  if (expected == null) return null;

  const steps = await ctx.ui.input(
    "Steps to reproduce. Put each step on its own line if possible.",
    "1. ",
  );
  if (steps == null) return null;

  return {
    kind,
    title: sanitizeText(title),
    summary: sanitizeText(summary),
    expected: sanitizeText(expected),
    steps: sanitizeText(steps),
  };
}

function buildHeadlessDraft(kind: IssueKind, title: string): FeedbackDraft {
  return {
    kind,
    title: title || "SF Pi feedback",
    summary: "Run /sf-feedback in interactive mode to provide details before submitting.",
    expected: "Not provided.",
    steps: "Not provided.",
  };
}

function optionLabel(kind: IssueKind): string {
  switch (kind) {
    case "bug":
      return "bug — Something is broken";
    case "feature":
      return "feature — Request an improvement";
    case "setup":
      return "setup — Install or configuration problem";
    case "feedback":
      return "feedback — General feedback";
  }
}

function renderPreview(title: string, labels: string[], body: string): string {
  const maxBody = body.length > 6000 ? `${body.slice(0, 6000)}\n\n… preview truncated …` : body;
  return [`Title: ${title}`, `Labels: ${labels.join(", ") || "none"}`, "", maxBody].join("\n");
}

function renderHelp(): string {
  return [
    "Usage:",
    "  /sf-feedback              Guided feedback flow",
    "  /sf-feedback bug          Start as a bug report",
    "  /sf-feedback feature      Start as a feature request",
    "  /sf-feedback setup        Start as a setup issue",
    "  /sf-feedback diagnostics  Show sanitized diagnostics only",
    "",
    "SF Feedback redacts org URLs, aliases, emails, tokens, home paths, and private remotes before previewing or submitting.",
  ].join("\n");
}

async function emitCommandOutput(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  summary: string,
  details: string,
  level: "info" | "warning" | "error",
): Promise<void> {
  if (ctx.hasUI) {
    await openInfoPanel(ctx, { title: summary, body: details || summary, severity: level });
    return;
  }

  ctx.ui.notify(summary, level);
  pi.sendMessage(
    {
      customType: COMMAND_NAME,
      content: details,
      display: true,
      details: {},
    },
    { triggerTurn: false },
  );
}

export { handleCommand, parseIssueKind };
