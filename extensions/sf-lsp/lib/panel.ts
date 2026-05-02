/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Rich `/sf-lsp` overlay panel.
 *
 * Three stacked sections rendered inside a DynamicBorder:
 *   1. Doctor (Apex / LWC / Agent Script availability)
 *   2. Recent activity (last N checks from the activity ring)
 *   3. Actions (SelectList with shutdown / refresh / toggle-hud / close)
 *
 * Pattern mirrors examples/extensions/preset.ts — SelectList + DynamicBorder
 * under ctx.ui.custom. Keeps input handling scoped to the list so users can
 * escape/enter/navigate without surprises.
 */
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
  visibleWidth,
} from "@mariozechner/pi-tui";
import {
  LANGUAGE_ORDER,
  formatDuration,
  formatRelativeAge,
  languageLongLabel,
  statusColor,
  type LspActivityStore,
} from "./activity.ts";
import type { LspDoctorStatus } from "./types.ts";

export type SfLspPanelAction =
  | "refresh-doctor"
  | "toggle-hud"
  | "toggle-verbose"
  | "shutdown-servers"
  | "close";

export interface SfLspPanelOptions {
  store: LspActivityStore;
  doctorStatuses: LspDoctorStatus[];
  hudEnabled: boolean;
  verboseEnabled: boolean;
}

export async function openSfLspPanel(
  ctx: ExtensionCommandContext,
  options: SfLspPanelOptions,
): Promise<SfLspPanelAction | null> {
  const result = await ctx.ui.custom<SfLspPanelAction | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    container.addChild(
      new Text(theme.fg("accent", theme.bold("🩻 SF LSP — status & controls")), 1, 0),
    );
    container.addChild(new Spacer(1));

    container.addChild(new Text(theme.fg("muted", " Doctor"), 1, 0));
    for (const line of buildDoctorLines(options.doctorStatuses, theme)) {
      container.addChild(new Text(line, 1, 0));
    }
    container.addChild(new Spacer(1));

    container.addChild(new Text(theme.fg("muted", " Recent activity"), 1, 0));
    for (const line of buildRecentLines(options.store, theme)) {
      container.addChild(new Text(line, 1, 0));
    }
    container.addChild(new Spacer(1));

    container.addChild(new Text(theme.fg("muted", " Actions"), 1, 0));
    const actionItems: SelectItem[] = [
      {
        value: "refresh-doctor",
        label: "Refresh doctor",
        description: "Re-probe Apex, LWC, and Agent Script LSP discovery",
      },
      {
        value: "toggle-hud",
        label: options.hudEnabled ? "Hide HUD overlay" : "Show HUD overlay",
        description: "Toggle the top-right LSP HUD",
      },
      {
        value: "toggle-verbose",
        label: options.verboseEnabled ? "Quiet transcript rows" : "Verbose transcript rows",
        description: "Verbose = emit a row for every check (not just errors/transitions)",
      },
      {
        value: "shutdown-servers",
        label: "Shut down LSP servers",
        description: "Kill all child LSP processes; they restart lazily",
      },
      {
        value: "close",
        label: "Close",
        description: "Dismiss this panel",
      },
    ];

    const list = new SelectList(actionItems, actionItems.length, {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    list.onSelect = (item) => done(item.value as SfLspPanelAction);
    list.onCancel = () => done("close");
    container.addChild(list);

    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc close"), 1, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });

  return result ?? null;
}

// -------------------------------------------------------------------------------------------------
// Line builders (pure, used for tests too)
// -------------------------------------------------------------------------------------------------

export function buildDoctorLines(statuses: LspDoctorStatus[], theme: Theme): string[] {
  const byLanguage = new Map(statuses.map((s) => [s.language, s]));
  return LANGUAGE_ORDER.map((language) => {
    const status = byLanguage.get(language);
    const label = theme.fg("text", padRight(languageLongLabel(language), 14));
    if (!status) {
      return `${theme.fg("dim", "?")} ${label}${theme.fg("dim", "not probed yet")}`;
    }
    if (status.available) {
      const source = status.source ? ` (${status.source})` : "";
      return `${theme.fg("success", "✓")} ${label}${theme.fg("dim", `${status.detail}${source}`)}`;
    }
    return `${theme.fg("error", "✗")} ${label}${theme.fg("warning", clampLine(status.detail, 120))}`;
  });
}

export function buildRecentLines(store: LspActivityStore, theme: Theme): string[] {
  if (store.recent.length === 0) {
    return [theme.fg("dim", "no checks yet this session")];
  }
  const now = Date.now();
  return store.recent.slice(0, 8).map((record) => {
    const color = statusColor(record.status);
    const lang = theme.fg("text", padRight(languageLongLabel(record.language), 14));
    const file = theme.fg("accent", padRight(record.fileName, 18));
    const badge = theme.fg(color, padRight(shortStatus(record.status), 6));
    const duration = theme.fg("dim", formatDuration(record.durationMs));
    const age = theme.fg("dim", formatRelativeAge(record.timestamp, now));
    const errors =
      record.status === "error" ? ` ${theme.fg("error", `${record.diagnosticCount} err`)}` : "";
    return `${lang}${file}${badge}${duration}  ${age}${errors}`;
  });
}

function shortStatus(status: string): string {
  switch (status) {
    case "clean":
    case "transition-clean":
      return "ok";
    case "error":
      return "err";
    case "unavailable":
      return "off";
    case "checking":
      return "…";
    default:
      return "—";
  }
}

function clampLine(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function padRight(value: string, width: number): string {
  const vis = visibleWidth(value);
  if (vis >= width) return value;
  return value + " ".repeat(width - vis);
}
