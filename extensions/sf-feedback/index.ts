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
import { buildExecFn } from "../../lib/common/exec-adapter.ts";
import type { ExecFn } from "../../lib/common/sf-environment/detect.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import {
  type SfPiCommandAction,
  formatHelpFromActions,
  getCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel } from "../../lib/common/info-panel.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import { sanitizeText } from "./lib/sanitize.ts";
import {
  createFeedbackWizardPanel,
  type FeedbackSubmitResult,
  type PreparedFeedbackPreview,
} from "./lib/feedback-wizard-panel.ts";
import type { Diagnostics, FeedbackDraft, IssueKind } from "./lib/types.ts";

const COMMAND_NAME = "sf-feedback";
const STATUS_KEY = "sf-feedback";

export default function sfFeedback(pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-feedback")) return;

  pi.registerCommand(COMMAND_NAME, {
    description: "Create sanitized SF Pi feedback or bug reports on GitHub",
    // Single source of truth: FEEDBACK_ACTIONS drives the panel rows, the
    // completions, and the auto-generated help text below.
    getArgumentCompletions: (prefix: string) =>
      getCompletionsFromActions(FEEDBACK_ACTIONS, prefix.trim().split(/\s+/).at(-1) ?? ""),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const exec = buildExecFn(pi, ctx.cwd);
        if (!(args || "").trim() && ctx.hasUI) {
          await openFeedbackInManager(pi, ctx, "detail");
          return;
        }
        await handleCommand(pi, ctx, exec, args || "");
      });
    },
  });

  registerManagerDetailActions(pi, COMMAND_NAME, buildFeedbackManagerActions(pi));
}

type FeedbackAction = "bug" | "feature" | "setup" | "feedback" | "diagnostics" | "help";

const FEEDBACK_ACTIONS: SfPiCommandAction<FeedbackAction>[] = [
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
];

function buildFeedbackManagerActions(pi: ExtensionAPI): ManagerDetailAction[] {
  return FEEDBACK_ACTIONS.map((action) => {
    const issueKind = isIssueKind(action.value) ? action.value : undefined;
    return {
      id: action.value,
      label: action.label,
      description: action.description,
      run: (ctx) => handleCommand(pi, ctx, buildExecFn(pi, ctx.cwd), action.value),
      ...(issueKind
        ? {
            createPanel: (theme, _cwd, _scope, done, ctx) =>
              createFeedbackWizardPanel(
                theme,
                issueKind,
                (draft) => prepareFeedbackPreview(ctx, buildExecFn(pi, ctx.cwd), draft),
                (preview) => submitPreparedFeedback(pi, ctx, buildExecFn(pi, ctx.cwd), preview),
                done,
              ),
          }
        : {}),
    } satisfies ManagerDetailAction;
  });
}

async function openFeedbackInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: COMMAND_NAME,
    view,
    actions: buildFeedbackManagerActions(pi),
  });

  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-feedback.", "warning");
  }
}

async function handleCommand(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  exec: ExecFn,
  rawArgs: string,
): Promise<void> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  // Resolve canonical names + aliases through the catalog so future aliases
  // (e.g. "dr" → "diagnostics") flow through one place.
  const subcommand = args[0]
    ? (resolveAction(FEEDBACK_ACTIONS, args[0]) ?? args[0]?.toLowerCase())
    : undefined;

  if (subcommand === "help") {
    await emitCommandOutput(pi, ctx, "SF Feedback help", renderHelp(), "info");
    return;
  }

  const [{ collectDiagnostics }, { buildDiagnosticsOnlyBody }] = await Promise.all([
    import("./lib/diagnostics.ts"),
    import("./lib/issue-template.ts"),
  ]);

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

    await submitFeedbackDraft(pi, ctx, exec, draft, diagnostics);
  } finally {
    ctx.ui.setStatus(STATUS_KEY, "");
  }
}

async function prepareFeedbackPreview(
  ctx: ExtensionCommandContext,
  exec: ExecFn,
  draft: FeedbackDraft,
  existingDiagnostics?: Diagnostics,
): Promise<PreparedFeedbackPreview & { fallbackUrl: string; diagnostics: Diagnostics }> {
  const [{ collectDiagnostics }, issueTemplate, github] = await Promise.all([
    import("./lib/diagnostics.ts"),
    import("./lib/issue-template.ts"),
    import("./lib/github.ts"),
  ]);
  const { buildIssueBody, labelForKind, normalizeIssueTitle } = issueTemplate;
  const { buildIssueUrl } = github;
  const diagnostics = existingDiagnostics ?? (await collectDiagnostics(exec, ctx.cwd));
  const title = normalizeIssueTitle(draft.kind, draft.title);
  const labels = labelForKind(draft.kind);
  const body = buildIssueBody(draft, diagnostics);
  const fallbackUrl = buildIssueUrl(title, body, labels);
  return { title, labels, body, fallbackUrl, diagnostics };
}

async function submitFeedbackDraft(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  exec: ExecFn,
  draft: FeedbackDraft,
  existingDiagnostics?: Diagnostics,
): Promise<void> {
  const preview = await prepareFeedbackPreview(ctx, exec, draft, existingDiagnostics);

  if (!ctx.hasUI) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF Feedback issue draft",
      `${preview.body}\n\nOpen this URL to create the issue:\n${preview.fallbackUrl}`,
      "info",
    );
    return;
  }

  const bodyPreview = renderPreview(preview.title, preview.labels, preview.body);
  const confirmed = await ctx.ui.confirm("Create GitHub issue?", bodyPreview);
  if (!confirmed) {
    await emitCommandOutput(
      pi,
      ctx,
      "SF Feedback cancelled.",
      `No issue was created. You can still open this prefilled URL:\n${preview.fallbackUrl}`,
      "info",
    );
    return;
  }

  const result = await submitPreparedFeedback(pi, ctx, exec, preview);
  await emitCommandOutput(pi, ctx, result.title, result.body, result.severity);
}

async function submitPreparedFeedback(
  _pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  exec: ExecFn,
  preview: PreparedFeedbackPreview & { fallbackUrl?: string; diagnostics?: Diagnostics },
): Promise<FeedbackSubmitResult> {
  const { createIssueWithGh, openUrl } = await import("./lib/github.ts");
  const diagnostics = preview.diagnostics;
  const fallbackUrl = preview.fallbackUrl ?? "";

  if (diagnostics?.github.ghAvailable && diagnostics.github.authenticated) {
    ctx.ui.setStatus(STATUS_KEY, "Feedback: creating GitHub issue…");
    const result = await createIssueWithGh(exec, preview.title, preview.body, preview.labels);
    if (result.ok) {
      return {
        title: "SF Feedback issue created.",
        body: result.url ? `Created: ${result.url}` : result.detail,
        severity: "info",
      };
    }

    if (!result.shouldOpenFallback) {
      return {
        title: "GitHub account cannot create this issue.",
        body: renderManualIssueDraft(
          result.detail,
          preview.title,
          preview.labels,
          preview.body,
          result.fallbackUrl,
        ),
        severity: "warning",
      };
    }

    await openUrl(exec, result.fallbackUrl);
    return {
      title: "Could not create issue with gh CLI.",
      body: `${result.detail}\n\nOpening a prefilled GitHub issue URL instead:\n${result.fallbackUrl}`,
      severity: "warning",
    };
  }

  const opened = fallbackUrl ? await openUrl(exec, fallbackUrl) : false;
  return opened
    ? {
        title: "Opening prefilled GitHub issue.",
        body: "GitHub CLI is unavailable or not authenticated, so SF Feedback opened a browser URL instead.",
        severity: "info",
      }
    : {
        title: "Open this GitHub issue URL manually.",
        body: fallbackUrl,
        severity: "warning",
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

function renderManualIssueDraft(
  detail: string,
  title: string,
  labels: string[],
  body: string,
  fallbackUrl: string,
): string {
  return [
    detail,
    "",
    "GitHub rejected issue creation for this account, and the browser issue form is likely to fail the same way.",
    "Copy the draft below and submit it from a GitHub account that can interact with the repository, or share it through your support/maintainer path.",
    "",
    `Prefilled URL, if you want to try from a different GitHub account: ${fallbackUrl}`,
    "",
    "---",
    "",
    `Title: ${title}`,
    `Labels: ${labels.join(", ") || "none"}`,
    "",
    body,
  ].join("\n");
}

function renderHelp(): string {
  return [
    formatHelpFromActions(FEEDBACK_ACTIONS, COMMAND_NAME),
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
