/* SPDX-License-Identifier: Apache-2.0 */
/** Lightweight TUI renderers for the d360 facade tool. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderCardCollapsed, renderCardExpanded, type D360ResultCard } from "./card.ts";

interface D360RenderArgs {
  action?: string;
  query?: string;
  operation?: string;
  runbook?: string;
  target_org?: string;
  dry_run?: boolean;
}

interface D360ApiRenderArgs {
  method?: string;
  path?: string;
  target_org?: string;
  dry_run?: boolean;
}

interface D360ProbeRenderArgs {
  target_org?: string;
}

interface D360MetadataRenderArgs {
  action?: string;
  api_name?: string;
  category?: string;
  target_org?: string;
}

interface D360RenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    summary?: string;
    card?: D360ResultCard;
    sfPi?: {
      summary?: string;
      data?: {
        card?: D360ResultCard;
      };
    };
  };
}

export function renderD360ApiCall(args: D360ApiRenderArgs, theme: Theme): Text {
  const bits = [
    args.method,
    args.path,
    args.target_org,
    args.dry_run ? "dry-run" : undefined,
  ].filter((bit): bit is string => typeof bit === "string" && bit.length > 0);
  return new Text(
    theme.fg("toolTitle", theme.bold("🔗 d360_api ")) + theme.fg("muted", bits.join(" · ")),
    0,
    0,
  );
}

export function renderD360ApiResult(
  result: D360RenderResult,
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  return renderD360CardResult(result, opts, theme, "☁️ d360_api · running…");
}

export function renderD360Call(args: D360RenderArgs, theme: Theme): Text {
  const action = args.action ?? "?";
  const subject = args.runbook ?? args.operation ?? args.query;
  const bits = [action, subject, args.target_org, args.dry_run ? "dry-run" : undefined].filter(
    (bit): bit is string => typeof bit === "string" && bit.length > 0,
  );
  return new Text(
    theme.fg("toolTitle", theme.bold("💠 d360 ")) + theme.fg("muted", bits.join(" · ")),
    0,
    0,
  );
}

export function renderD360Result(
  result: D360RenderResult,
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  return renderD360CardResult(result, opts, theme, "💠 d360 · running…");
}

export function renderD360ProbeCall(args: D360ProbeRenderArgs, theme: Theme): Text {
  const bits = [args.target_org].filter(
    (bit): bit is string => typeof bit === "string" && bit.length > 0,
  );
  return new Text(
    theme.fg("toolTitle", theme.bold("📊 d360 probe ")) + theme.fg("muted", bits.join(" · ")),
    0,
    0,
  );
}

export function renderD360ProbeResult(
  result: D360RenderResult,
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  return renderD360CardResult(result, opts, theme, "📊 d360_probe · running…");
}

export function renderD360MetadataCall(args: D360MetadataRenderArgs, theme: Theme): Text {
  const bits = [args.action, args.api_name, args.category, args.target_org].filter(
    (bit): bit is string => typeof bit === "string" && bit.length > 0,
  );
  return new Text(
    theme.fg("toolTitle", theme.bold("🗂️ d360 metadata ")) + theme.fg("muted", bits.join(" · ")),
    0,
    0,
  );
}

export function renderD360MetadataResult(
  result: D360RenderResult,
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  return renderD360CardResult(result, opts, theme, "🗂️ d360_metadata · running…");
}

export function renderD360CardResult(
  result: D360RenderResult,
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
  partialLabel: string,
): Text {
  if (opts.isPartial) return new Text(theme.fg("warning", partialLabel), 0, 0);

  const card = result.details?.card ?? result.details?.sfPi?.data?.card;
  if (card) {
    const rendered = opts.expanded
      ? renderCardExpanded(card, { expandedMaxLines: 40, indentBody: true })
      : renderCardCollapsed(card, { collapsedMaxLines: 12, indentBody: true });
    return new Text(styleCardText(rendered, card.status, theme), 0, 0);
  }

  const ok = result.details?.ok !== false;
  const summary = result.details?.summary ?? result.details?.sfPi?.summary ?? firstText(result);
  return new Text(theme.fg(ok ? "success" : "error", `${ok ? "✓" : "✗"} ${summary}`), 0, 0);
}

function styleCardText(text: string, status: D360ResultCard["status"], theme: Theme): string {
  const lines = text.split("\n");
  const title = lines[0] ?? "";
  const titleToken = status === "error" ? "error" : status === "warning" ? "warning" : "toolTitle";
  return [theme.fg(titleToken, title), ...lines.slice(1)].join("\n");
}

function firstText(result: D360RenderResult): string {
  const first = result.content?.find((item): item is { type?: string; text?: string } =>
    Boolean(item && typeof item === "object" && "text" in item),
  );
  return first?.text ?? "d360 completed";
}
