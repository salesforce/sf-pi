/* SPDX-License-Identifier: Apache-2.0 */
/** Closed-loop semantic navigation for Salesforce Setup categories, items, and entry menus. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeLatestBrowserSnapshotRefs } from "../../../lib/common/sf-browser-snapshot-state.ts";
import { runAgentBrowser } from "./agent-browser.ts";
import { renderBrowserToolCall, renderBrowserToolResult } from "./browser-render.ts";
import { captureVisualCheckpoint, openOrgInAgentBrowser } from "./operations.ts";
import {
  findGlobalSetupButton,
  findQuickFindRef,
  findSetupCategory,
  findSetupItemCandidates,
  findSetupMenuEntry,
  setupMenuEntryLabels,
  setupNavigationLabels,
  type SetupCategoryMatch,
} from "./setup-navigation.ts";
import { startTimer } from "./timing.ts";
import { okText, writeBrowserArtifact } from "./tool-support.ts";

export const SF_BROWSER_NAVIGATE_SETUP_TOOL_NAME = "sf_browser_navigate_setup";

type SetupNavigationTarget =
  | { type: "category"; label: string; desiredState?: boolean }
  | { type: "item"; label: string; category?: string }
  | { type: "global-entry"; label: string };

type SetupNavigationStatus =
  "reached" | "already-in-state" | "not-found" | "ambiguous" | "postcondition-failed";

export function registerSfBrowserNavigateSetupTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_NAVIGATE_SETUP_TOOL_NAME,
    label: "SF Browser Navigate Setup",
    description:
      "Navigate Salesforce Setup by exact category, item, or top-right Setup menu entry. The operation opens Setup Home in the target org, uses bounded exact-label discovery, verifies the resulting state, and returns candidates instead of guessing.",
    promptSnippet:
      "Navigate exact Salesforce Setup categories, items, and top-right Setup entries with closed-loop verification",
    promptGuidelines: [
      "Use sf_browser_navigate_setup for Setup categories and long-tail Setup items that are not curated sf_browser_open_org destinations.",
      "Use exact Salesforce labels and add category for duplicate item labels. The tool returns not-found or ambiguous rather than fuzzy-clicking.",
      "Prefer sf_browser_open_org for known curated Setup destinations and deterministic paths.",
    ],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    renderCall: (args, theme) =>
      renderBrowserToolCall(SF_BROWSER_NAVIGATE_SETUP_TOOL_NAME, args, theme),
    renderResult: (result, options, theme, context) =>
      renderBrowserToolResult(SF_BROWSER_NAVIGATE_SETUP_TOOL_NAME, result, options, theme, context),
    parameters: Type.Object({
      target_org: Type.Optional(
        Type.String({
          description: "Salesforce org alias or username. Defaults to active sf-pi target org.",
        }),
      ),
      target: Type.Union([
        Type.Object({
          type: Type.Literal("category"),
          label: Type.String({ description: "Exact Setup category label, such as Security." }),
          desiredState: Type.Optional(
            Type.Boolean({ description: "true to expand (default); false to collapse." }),
          ),
        }),
        Type.Object({
          type: Type.Literal("item"),
          label: Type.String({ description: "Exact Setup item label, such as Health Check." }),
          category: Type.Optional(
            Type.String({ description: "Optional exact parent category for disambiguation." }),
          ),
        }),
        Type.Object({
          type: Type.Literal("global-entry"),
          label: Type.String({
            description:
              "Exact top-right Setup menu entry, such as Setup, Data Cloud Setup, or Service Setup.",
          }),
        }),
      ]),
    }),
    async execute(toolCallId, params, signal, _onUpdate, ctx) {
      const stopTimer = startTimer();
      await openOrgInAgentBrowser(
        pi,
        ctx,
        {
          target_org: params.target_org,
          target: { type: "setup", destination: "setup-home" },
          purpose: `Navigate Salesforce Setup ${params.target.type}`,
        },
        signal,
      );

      let initialSnapshot = await pollForSetupSnapshot(pi, ctx.cwd, signal);
      const requiredCategory =
        params.target.type === "category"
          ? params.target.label
          : params.target.type === "item"
            ? params.target.category
            : undefined;
      if (requiredCategory && !findSetupCategory(initialSnapshot, requiredCategory)) {
        initialSnapshot = await switchToStandardSetup(
          pi,
          ctx.cwd,
          initialSnapshot,
          requiredCategory,
          signal,
        );
      }
      let outcome: NavigationOutcome;
      if (params.target.type === "category") {
        outcome = await navigateCategory(
          pi,
          ctx.cwd,
          initialSnapshot,
          params.target.label,
          params.target.desiredState !== false,
          signal,
        );
      } else if (params.target.type === "item") {
        outcome = await navigateItem(
          pi,
          ctx.cwd,
          initialSnapshot,
          params.target.label,
          params.target.category,
          signal,
        );
      } else {
        outcome = await navigateGlobalEntry(
          pi,
          ctx.cwd,
          initialSnapshot,
          params.target.label,
          signal,
        );
      }

      const observedUrl = await currentBrowserUrl(pi, ctx.cwd, signal);
      const sessionId = ctx.sessionManager.getSessionId();
      const fullSnapshotPath = writeBrowserArtifact(outcome.snapshot, {
        label: "setup-navigation-snapshot",
        extension: "txt",
        sessionId,
      });
      writeLatestBrowserSnapshotRefs({
        sessionId,
        snapshot: outcome.snapshot,
        url: observedUrl,
        fullSnapshotPath,
      });
      const evidence =
        outcome.status === "reached" || outcome.status === "already-in-state"
          ? await captureVisualCheckpoint(
              pi,
              ctx,
              {
                label: `setup-navigation-${params.target.type}`,
                imageMode: "artifact",
                dismissOverlays: false,
                ifChanged: true,
                forceThumbnail: true,
                currentUrl: observedUrl,
                stepId: toolCallId,
                phase: "after",
                toolName: SF_BROWSER_NAVIGATE_SETUP_TOOL_NAME,
              },
              signal,
            )
          : undefined;
      const duration = stopTimer();
      const text = okText([
        `Setup navigation: ${outcome.status}.`,
        `Target: ${formatTarget(params.target as SetupNavigationTarget)}`,
        outcome.message,
        outcome.candidates?.length ? `Candidates: ${outcome.candidates.join("; ")}` : undefined,
        observedUrl ? `Observed URL: ${observedUrl}` : undefined,
        `Duration: ${duration.durationText}`,
      ]);
      return {
        content: [{ type: "text" as const, text }],
        details: {
          ok: outcome.status === "reached" || outcome.status === "already-in-state",
          status: outcome.status,
          target: params.target,
          candidates: outcome.candidates,
          observedUrl,
          expectedPath: outcome.expectedPath,
          fullSnapshotPath,
          evidence: evidence?.details.capture,
          ...duration,
        },
        ...(outcome.status === "postcondition-failed" ? { isError: true } : {}),
      };
    },
  });
}

type NavigationOutcome = {
  status: SetupNavigationStatus;
  snapshot: string;
  message: string;
  candidates?: string[];
  expectedPath?: string;
};

async function switchToStandardSetup(
  pi: ExtensionAPI,
  cwd: string,
  initialSnapshot: string,
  requiredCategory: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  let snapshot = initialSnapshot;
  let setupButton = findGlobalSetupButton(snapshot);
  if (!setupButton) return snapshot;
  if (setupButton.expanded === false) {
    await runAgentBrowser(pi, ["click", setupButton.treeRef], { cwd, signal });
    const observed = await pollGlobalSetupState(pi, cwd, true, signal);
    snapshot = observed.snapshot;
    setupButton = observed.button;
  }
  if (setupButton?.expanded !== true) return snapshot;
  const menu = await pollSetupMenuEntry(pi, cwd, snapshot, "Setup", signal);
  snapshot = menu.snapshot;
  if (!menu.entry) return snapshot;
  await runAgentBrowser(pi, ["click", menu.entry.ref], { cwd, signal });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) await shortWait(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    if (findSetupCategory(snapshot, requiredCategory)) return snapshot;
  }
  return snapshot;
}

async function navigateCategory(
  pi: ExtensionAPI,
  cwd: string,
  snapshot: string,
  label: string,
  desiredState: boolean,
  signal: AbortSignal | undefined,
): Promise<NavigationOutcome> {
  const category = findSetupCategory(snapshot, label);
  if (!category) {
    return {
      status: "not-found",
      snapshot,
      message: `Exact Setup category ${JSON.stringify(label)} was not found.`,
      candidates: setupNavigationLabels(snapshot),
    };
  }
  if (category.expanded === desiredState) {
    return {
      status: "already-in-state",
      snapshot,
      message: `${category.label} was already ${desiredState ? "expanded" : "collapsed"}.`,
    };
  }
  if (!category.expansionRef) {
    return {
      status: "postcondition-failed",
      snapshot,
      message: `${category.label} did not expose an Expand/Collapse control.`,
    };
  }
  await runAgentBrowser(pi, ["click", category.expansionRef], { cwd, signal });
  let observed = await pollCategoryState(pi, cwd, category.label, desiredState, signal);
  if (observed.category?.expanded !== desiredState && observed.category?.expansionRef) {
    await runAgentBrowser(pi, ["click", observed.category.expansionRef], { cwd, signal });
    observed = await pollCategoryState(pi, cwd, category.label, desiredState, signal);
  }
  return observed.category?.expanded === desiredState
    ? {
        status: "reached",
        snapshot: observed.snapshot,
        message: `${category.label} is now ${desiredState ? "expanded" : "collapsed"}.`,
      }
    : {
        status: "postcondition-failed",
        snapshot: observed.snapshot,
        message: `A fresh snapshot did not confirm ${category.label} as ${desiredState ? "expanded" : "collapsed"}.`,
      };
}

async function navigateItem(
  pi: ExtensionAPI,
  cwd: string,
  initialSnapshot: string,
  label: string,
  categoryLabel: string | undefined,
  signal: AbortSignal | undefined,
): Promise<NavigationOutcome> {
  let snapshot = initialSnapshot;
  if (categoryLabel) {
    const category = findSetupCategory(snapshot, categoryLabel);
    if (!category) {
      return {
        status: "not-found",
        snapshot,
        message: `Exact Setup category ${JSON.stringify(categoryLabel)} was not found.`,
        candidates: setupNavigationLabels(snapshot),
      };
    }
    if (category.expanded === false && category.expansionRef) {
      await runAgentBrowser(pi, ["click", category.expansionRef], { cwd, signal });
      snapshot = (await pollCategoryState(pi, cwd, category.label, true, signal)).snapshot;
    }
  }

  const quickFindRef = findQuickFindRef(snapshot);
  if (!quickFindRef) {
    return {
      status: "postcondition-failed",
      snapshot,
      message: "Setup Quick Find was not available in the current Setup surface.",
    };
  }
  await runAgentBrowser(pi, ["fill", quickFindRef, label], { cwd, signal });
  const filtered = await pollSetupItemCandidates(pi, cwd, label, categoryLabel, signal);
  snapshot = filtered.snapshot;
  if (filtered.candidates.length === 0) {
    return {
      status: "not-found",
      snapshot,
      message: `Exact Setup item ${JSON.stringify(label)} was not found.`,
      candidates: setupNavigationLabels(snapshot),
    };
  }
  if (filtered.candidates.length > 1) {
    return {
      status: "ambiguous",
      snapshot,
      message: `Setup item ${JSON.stringify(label)} matched more than one visible item.`,
      candidates: filtered.candidates.map((item) =>
        [item.category, item.label].filter(Boolean).join(" / "),
      ),
    };
  }
  const item = filtered.candidates[0];
  if (!item?.linkRef) {
    return {
      status: "postcondition-failed",
      snapshot,
      message: `Setup item ${JSON.stringify(label)} did not expose a navigable link.`,
    };
  }
  const expectedPath = await hrefPath(pi, cwd, item.linkRef, signal);
  await runAgentBrowser(pi, ["click", item.linkRef], { cwd, signal });
  const reached = await pollItemReached(pi, cwd, label, categoryLabel, expectedPath, signal);
  return reached.reached
    ? {
        status: "reached",
        snapshot: reached.snapshot,
        message: `Reached Setup item ${item.category ? `${item.category} / ` : ""}${item.label}.`,
        expectedPath,
      }
    : {
        status: "postcondition-failed",
        snapshot: reached.snapshot,
        message: `The click was dispatched, but a fresh URL or selected Setup item did not confirm ${JSON.stringify(label)}.`,
        expectedPath,
      };
}

async function navigateGlobalEntry(
  pi: ExtensionAPI,
  cwd: string,
  initialSnapshot: string,
  label: string,
  signal: AbortSignal | undefined,
): Promise<NavigationOutcome> {
  let snapshot = initialSnapshot;
  let setupButton = findGlobalSetupButton(snapshot);
  if (!setupButton) {
    return {
      status: "postcondition-failed",
      snapshot,
      message: "The top-right Setup menu button was not available.",
    };
  }
  if (setupButton.expanded === false) {
    await runAgentBrowser(pi, ["click", setupButton.treeRef], { cwd, signal });
    const observed = await pollGlobalSetupState(pi, cwd, true, signal);
    snapshot = observed.snapshot;
    setupButton = observed.button;
  }
  if (setupButton?.expanded !== true) {
    return {
      status: "postcondition-failed",
      snapshot,
      message: "A fresh snapshot did not confirm that the top-right Setup menu opened.",
    };
  }
  const menu = await pollSetupMenuEntry(pi, cwd, snapshot, label, signal);
  snapshot = menu.snapshot;
  const entry = menu.entry;
  if (!entry) {
    return {
      status: "not-found",
      snapshot,
      message: `Exact top-right Setup entry ${JSON.stringify(label)} was not found.`,
      candidates: setupMenuEntryLabels(snapshot),
    };
  }
  const expectedPath = await hrefPath(pi, cwd, entry.ref, signal);
  const beforeUrl = await currentBrowserUrl(pi, cwd, signal);
  await runAgentBrowser(pi, ["click", entry.ref], { cwd, signal });
  const reached = await pollNavigationPath(pi, cwd, beforeUrl, expectedPath, signal);
  return reached.reached
    ? {
        status: "reached",
        snapshot: reached.snapshot,
        message: `Reached top-right Setup entry ${entry.label}.`,
        expectedPath,
      }
    : {
        status: "postcondition-failed",
        snapshot: reached.snapshot,
        message: `The menu click was dispatched, but the browser did not confirm ${JSON.stringify(label)}.`,
        expectedPath,
      };
}

async function pollForSetupSnapshot(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  let snapshot = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) await shortWait(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    if (findQuickFindRef(snapshot) && findGlobalSetupButton(snapshot)) return snapshot;
  }
  return snapshot;
}

async function pollCategoryState(
  pi: ExtensionAPI,
  cwd: string,
  label: string,
  desiredState: boolean,
  signal: AbortSignal | undefined,
): Promise<{ snapshot: string; category?: SetupCategoryMatch }> {
  let snapshot = "";
  let category: SetupCategoryMatch | undefined;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await shortWait(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    category = findSetupCategory(snapshot, label);
    if (category?.expanded === desiredState) break;
  }
  return { snapshot, category };
}

async function pollGlobalSetupState(
  pi: ExtensionAPI,
  cwd: string,
  desiredState: boolean,
  signal: AbortSignal | undefined,
): Promise<{ snapshot: string; button?: SetupCategoryMatch }> {
  let snapshot = "";
  let button: SetupCategoryMatch | undefined;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt > 0) await shortWait(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    button = findGlobalSetupButton(snapshot);
    if (button?.expanded === desiredState) break;
  }
  return { snapshot, button };
}

async function pollSetupMenuEntry(
  pi: ExtensionAPI,
  cwd: string,
  initialSnapshot: string,
  label: string,
  signal: AbortSignal | undefined,
): Promise<{ snapshot: string; entry: ReturnType<typeof findSetupMenuEntry> }> {
  let snapshot = initialSnapshot;
  let entry = findSetupMenuEntry(snapshot, label);
  for (let attempt = 0; !entry && attempt < 8; attempt += 1) {
    await shortWait(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    entry = findSetupMenuEntry(snapshot, label);
  }
  return { snapshot, entry };
}

async function pollSetupItemCandidates(
  pi: ExtensionAPI,
  cwd: string,
  label: string,
  category: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ snapshot: string; candidates: ReturnType<typeof findSetupItemCandidates> }> {
  let snapshot = "";
  let candidates: ReturnType<typeof findSetupItemCandidates> = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) await shortWait(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    candidates = findSetupItemCandidates(snapshot, label, category);
    if (candidates.length) break;
  }
  return { snapshot, candidates };
}

async function pollItemReached(
  pi: ExtensionAPI,
  cwd: string,
  label: string,
  category: string | undefined,
  expectedPath: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ reached: boolean; snapshot: string }> {
  let snapshot = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) await shortWait(pi, cwd, signal);
    const url = await currentBrowserUrl(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    const selected = findSetupItemCandidates(snapshot, label, category).some(
      (item) => item.selected,
    );
    if ((expectedPath && pathname(url) === expectedPath) || selected) {
      return { reached: true, snapshot };
    }
  }
  return { reached: false, snapshot };
}

async function pollNavigationPath(
  pi: ExtensionAPI,
  cwd: string,
  beforeUrl: string | undefined,
  expectedPath: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ reached: boolean; snapshot: string }> {
  let snapshot = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (attempt > 0) await shortWait(pi, cwd, signal);
    const url = await currentBrowserUrl(pi, cwd, signal);
    snapshot = await interactiveSnapshot(pi, cwd, signal);
    if (
      (expectedPath && pathname(url) === expectedPath) ||
      (!expectedPath && url && beforeUrl && url !== beforeUrl)
    ) {
      return { reached: true, snapshot };
    }
  }
  return { reached: false, snapshot };
}

async function interactiveSnapshot(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const result = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
    cwd,
    signal,
    timeoutMs: 15_000,
  });
  return result.stdout.trim();
}

async function shortWait(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  await runAgentBrowser(pi, ["wait", "250"], { cwd, signal, timeoutMs: 5_000 });
}

async function hrefPath(
  pi: ExtensionAPI,
  cwd: string,
  ref: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "attr", ref, "href"], {
      cwd,
      signal,
      timeoutMs: 10_000,
    });
    return pathname(result.stdout.trim().replace(/^"|"$/gu, ""));
  } catch {
    return undefined;
  }
}

async function currentBrowserUrl(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string | undefined> {
  try {
    const result = await runAgentBrowser(pi, ["get", "url"], {
      cwd,
      signal,
      timeoutMs: 10_000,
    });
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function pathname(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, "https://sf-pi.invalid").pathname.replace(/\/$/u, "");
  } catch {
    return undefined;
  }
}

function formatTarget(target: SetupNavigationTarget): string {
  if (target.type === "category") {
    return `${target.label} (${target.desiredState === false ? "collapse" : "expand"})`;
  }
  if (target.type === "item") {
    return [target.category, target.label].filter(Boolean).join(" / ");
  }
  return `top-right Setup / ${target.label}`;
}
