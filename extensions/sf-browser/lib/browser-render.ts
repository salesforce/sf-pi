/* SPDX-License-Identifier: Apache-2.0 */
/** Compact, evidence-first TUI cards shared by SF Browser tools. */
import { existsSync, readFileSync } from "node:fs";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Container, Image, Spacer, Text, type Component } from "@earendil-works/pi-tui";
import {
  renderSfPiResultCardText,
  renderSfPiToolCallLine,
  type SfPiArtifact,
  type SfPiResultCard,
} from "../../../lib/common/display/result-card.ts";

interface ToolResultLike {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details?: unknown;
}

interface RenderOptions {
  expanded?: boolean;
  isPartial?: boolean;
}

interface RenderContextLike {
  args?: unknown;
  isError?: boolean;
}

export const SF_BROWSER_IMAGE_WIDTH_CELLS = 90;

const TOOL_META: Record<string, { action: string; icon: string; label: string }> = {
  sf_browser_open_org: { action: "Open", icon: "🧭", label: "SF Browser" },
  sf_browser_snapshot: { action: "Observe", icon: "🔎", label: "SF Browser" },
  sf_browser_click: { action: "Click", icon: "🖱", label: "SF Browser" },
  sf_browser_fill: { action: "Fill", icon: "✏️", label: "SF Browser" },
  sf_browser_select: { action: "Select", icon: "☑", label: "SF Browser" },
  sf_browser_set_toggle: { action: "Set toggle", icon: "🎚", label: "SF Browser" },
  sf_browser_press: { action: "Press", icon: "⌨️", label: "SF Browser" },
  sf_browser_editor: { action: "Editor", icon: "📝", label: "SF Browser" },
  sf_browser_wait: { action: "Wait", icon: "⏳", label: "SF Browser" },
  sf_browser_capture_evidence: { action: "Capture", icon: "📸", label: "SF Browser" },
  sf_browser_resolve_path: { action: "Resolve", icon: "🗺", label: "SF Browser" },
};

export function renderBrowserToolCall(toolName: string, args: unknown, theme: Theme): Component {
  const meta = metaFor(toolName);
  return new Text(
    renderSfPiToolCallLine(
      {
        icon: meta.icon,
        label: meta.label,
        action: meta.action,
        subject: callSubject(toolName, asRecord(args)),
        scope: stringValue(asRecord(args).target_org),
      },
      theme,
    ),
    0,
    0,
  );
}

export function renderBrowserToolResult(
  toolName: string,
  result: ToolResultLike,
  options: RenderOptions,
  theme: Theme,
  context: RenderContextLike = {},
): Component {
  const details = asRecord(result.details);
  if (options.isPartial) {
    const phase = stringValue(details.phase) ?? `Running ${metaFor(toolName).action.toLowerCase()}`;
    return new Text(theme.fg("warning", `⏳ SF Browser · ${phase}`), 0, 0);
  }

  const card = buildBrowserResultCard(toolName, result, context);
  const container = new Container();
  container.addChild(
    new Text(renderSfPiResultCardText(card, { expanded: options.expanded }, theme), 0, 0),
  );
  const thumbnailPath = result.content?.some((item) => item.type === "image")
    ? undefined
    : latestThumbnailPath(asRecord(result.details));
  if (thumbnailPath && existsSync(thumbnailPath)) {
    const mimeType = /\.jpe?g$/iu.test(thumbnailPath) ? "image/jpeg" : "image/png";
    container.addChild(new Spacer(1));
    container.addChild(
      new Image(
        readFileSync(thumbnailPath).toString("base64"),
        mimeType,
        { fallbackColor: (text) => theme.fg("toolOutput", text) },
        { maxWidthCells: SF_BROWSER_IMAGE_WIDTH_CELLS, filename: thumbnailPath },
      ),
    );
  }
  return container;
}

export function buildBrowserResultCard(
  toolName: string,
  result: ToolResultLike,
  context: RenderContextLike = {},
): SfPiResultCard {
  const details = asRecord(result.details);
  const args = asRecord(context.args);
  const meta = metaFor(toolName);
  const failed = context.isError === true || details.ok === false;
  const duration = stringValue(details.durationText);
  const artifacts = collectArtifacts(details);
  const title = resultTitle(toolName, args, details, result);
  const summary = resultSummary(toolName, result, details, failed);
  const method = formatOpenMethod(stringValue(details.openMethod));
  const scope = [
    fact("org", stringValue(details.targetOrg)),
    fact("path", stringValue(details.path)),
    fact("method", method),
    fact("status", stringValue(details.status)),
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));

  return {
    tool: { id: toolName, label: meta.label, icon: meta.icon },
    title,
    status: failed ? "error" : details.ambiguous ? "warning" : "success",
    summary,
    chips: [
      duration ? { label: duration, tone: "muted" as const } : undefined,
      artifacts.length
        ? {
            label: `${artifacts.length} screenshot${artifacts.length === 1 ? "" : "s"}`,
            tone: "info" as const,
          }
        : undefined,
    ].filter((value): value is NonNullable<typeof value> => Boolean(value)),
    scope,
    rails: executionRails(toolName, details),
    sections: resultSections(toolName, details),
    artifacts,
    next: [nextStep(toolName, details, failed)],
    renderHints: { collapsedLines: 14, expandedMaxLines: 80, profile: "balanced" },
  };
}

function metaFor(toolName: string): { action: string; icon: string; label: string } {
  return TOOL_META[toolName] ?? { action: "Run", icon: "🌐", label: "SF Browser" };
}

function callSubject(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === "sf_browser_open_org" || toolName === "sf_browser_resolve_path") {
    return targetLabel(asRecord(args.target));
  }
  if (toolName === "sf_browser_snapshot") {
    const focus = stringArray(args.focus);
    return focus.length ? focus.slice(0, 2).join(", ") : "Current page";
  }
  if (toolName === "sf_browser_wait") return waitLabel(asRecord(args.condition));
  if (toolName === "sf_browser_set_toggle") {
    return `${stringValue(args.ref) ?? "control"} → ${args.desiredState === true ? "On" : "Off"}`;
  }
  return stringValue(args.ref) ?? stringValue(args.key) ?? stringValue(args.action);
}

function resultTitle(
  toolName: string,
  args: Record<string, unknown>,
  details: Record<string, unknown>,
  result: ToolResultLike,
): string {
  if (toolName === "sf_browser_open_org") {
    return `Open Setup · ${targetLabel(asRecord(args.target)) ?? pathTail(stringValue(details.path)) ?? "Salesforce"}`;
  }
  if (toolName === "sf_browser_snapshot") {
    return `Observe · ${snapshotHeading(result) ?? pathTail(stringValue(details.currentUrl)) ?? "Salesforce"}`;
  }
  if (toolName === "sf_browser_set_toggle") {
    return `Set Toggle · ${stringValue(details.label) ?? stringValue(args.ref) ?? "Control"}`;
  }
  return `${metaFor(toolName).action} · ${callSubject(toolName, args) ?? "Salesforce"}`;
}

function resultSummary(
  toolName: string,
  result: ToolResultLike,
  details: Record<string, unknown>,
  failed: boolean,
): string {
  if (failed) {
    return (
      stringValue(details.recovery) ?? firstTextLine(result) ?? "The browser action was blocked."
    );
  }
  if (toolName === "sf_browser_open_org") {
    const target = stringValue(details.targetOrg) ?? "the target org";
    return `${pathTail(stringValue(details.path)) ?? "Salesforce"} is ready in ${target}.`;
  }
  if (toolName === "sf_browser_snapshot") {
    const heading = snapshotHeading(result) ?? pathTail(stringValue(details.currentUrl));
    return heading
      ? `${heading} is ready for ref-based interaction.`
      : "The current Salesforce page is ready for ref-based interaction.";
  }
  if (toolName === "sf_browser_set_toggle") {
    const state = details.desiredState === true ? "On" : "Off";
    return `${stringValue(details.label) ?? "The control"} is ${state} in the observed page state.`;
  }
  return firstTextLine(result) ?? `${metaFor(toolName).action} completed.`;
}

function executionRails(toolName: string, details: Record<string, unknown>) {
  if (toolName === "sf_browser_open_org") {
    return [
      {
        label: "Browser" as const,
        items: [
          {
            verb: "Access",
            target: formatOpenMethod(stringValue(details.openMethod)) ?? "Salesforce org",
            tone: "info" as const,
          },
          {
            verb: "Navigate",
            target: stringValue(details.path) ?? "requested page",
          },
          {
            verb: "Verify",
            target:
              details.navigationCorrectionApplied === true
                ? "requested path after bounded correction"
                : "requested path",
            tone: "success" as const,
          },
        ],
      },
    ];
  }
  if (toolName === "sf_browser_set_toggle") {
    return [
      {
        label: "Browser" as const,
        items: [
          { verb: "Before", target: booleanState(details.previousState) },
          {
            verb: "Set",
            target: booleanState(details.desiredState),
            detail:
              details.recoveredClassicSetup === true ? "Classic Setup keyboard adapter" : undefined,
            tone: "info" as const,
          },
          {
            verb: "Verify",
            target: booleanState(details.observedState),
            tone:
              details.observedState === details.desiredState
                ? ("success" as const)
                : ("warning" as const),
          },
        ],
      },
    ];
  }
  return undefined;
}

function resultSections(toolName: string, details: Record<string, unknown>) {
  if (toolName !== "sf_browser_set_toggle") return undefined;
  return [
    {
      title: "State",
      icon: "🎚",
      rows: [
        { label: "control", value: stringValue(details.label) ?? "toggle" },
        {
          label: "persistence",
          value: stringValue(details.persistence) ?? "UI state only",
          tone: details.persistence === "pending-save" ? ("warning" as const) : ("info" as const),
        },
      ],
    },
  ];
}

function booleanState(value: unknown): string {
  return value === true ? "On" : value === false ? "Off" : "Unknown";
}

function nextStep(toolName: string, details: Record<string, unknown>, failed: boolean): string {
  if (failed) return "Review recovery evidence, then retry from a fresh snapshot";
  if (toolName === "sf_browser_open_org") return "Snapshot current controls before acting";
  if (toolName === "sf_browser_set_toggle" && details.persistence === "pending-save") {
    return "Use the explicit Save control, then verify the resulting state";
  }
  if (toolName === "sf_browser_snapshot") return "Use a current ref for the next action";
  if (toolName === "sf_browser_wait") return "Review the checkpoint evidence before continuing";
  return "Wait and snapshot after any page-changing action";
}

function latestThumbnailPath(details: Record<string, unknown>): string | undefined {
  const candidates = [
    details.afterActionEvidence,
    details.checkpointEvidence,
    details.evidence,
    details.capture,
    details.beforeMutationEvidence,
  ];
  for (const candidate of candidates) {
    const thumbnailPath = stringValue(asRecord(candidate).thumbnailPath);
    if (thumbnailPath) return thumbnailPath;
  }
  return undefined;
}

function collectArtifacts(details: Record<string, unknown>): SfPiArtifact[] {
  const candidates = [
    details.evidence,
    details.capture,
    details.beforeMutationEvidence,
    details.afterActionEvidence,
    details.checkpointEvidence,
  ];
  const artifacts: SfPiArtifact[] = [];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const path = stringValue(record.path);
    if (!path || artifacts.some((item) => item.path === path)) continue;
    artifacts.push({
      label: stringValue(record.label) ?? "screenshot",
      path,
      kind: "image",
    });
  }
  const diagnosticPath = stringValue(details.screenshotPath);
  if (diagnosticPath && !artifacts.some((item) => item.path === diagnosticPath)) {
    artifacts.push({ label: "diagnostic screenshot", path: diagnosticPath, kind: "image" });
  }
  return artifacts;
}

function targetLabel(target: Record<string, unknown>): string | undefined {
  const type = stringValue(target.type);
  if (type === "setup" || type === "data-cloud") {
    return titleCaseWords(stringValue(target.destination));
  }
  if (type === "path") return pathTail(stringValue(target.path));
  if (type === "record-view" || type === "object-list" || type === "object-new") {
    return stringValue(target.objectApiName);
  }
  if (type === "external-client-app") return stringValue(target.appName);
  return type ? titleCaseWords(type) : undefined;
}

function waitLabel(condition: Record<string, unknown>): string | undefined {
  const type = stringValue(condition.type);
  const value = condition.value;
  return type && value !== undefined ? `${titleCaseWords(type)} ${String(value)}` : undefined;
}

function fact(label: string, value: string | undefined) {
  return value ? { label, value, tone: "info" as const } : undefined;
}

function snapshotHeading(result: ToolResultLike): string | undefined {
  const text = result.content?.find((item) => item.type === "text")?.text;
  return text?.match(/^- Heading: - heading "([^"]+)"/mu)?.[1]?.trim();
}

function firstTextLine(result: ToolResultLike): string | undefined {
  const text = result.content?.find((item) => item.type === "text")?.text;
  return text
    ?.split(/\r?\n/u)
    .find((line) => line.trim())
    ?.trim();
}

function formatOpenMethod(value: string | undefined): string | undefined {
  if (value === "same-org-direct") return "same-org direct";
  if (value === "in-process-singleaccess") return "in-process single-access";
  if (value === "sf-cli-fallback") return "sf org open fallback";
  return value;
}

function pathTail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const path = value.split(/[?#]/u, 1)[0] ?? value;
  const parts = path.split("/").filter(Boolean);
  const tail = parts.at(-2) === "setup" ? parts.at(-1) : (parts.at(-2) ?? parts.at(-1));
  return titleCaseWords(tail);
}

function titleCaseWords(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/[-_]+/gu, " ").replace(/\b\w/gu, (character) => character.toUpperCase());
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
