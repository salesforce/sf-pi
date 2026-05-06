/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared in-TUI information popup for command panels.
 *
 * Use this for status/help/result text that is part of an interactive command
 * flow. It keeps output close to the panel instead of appending long blocks to
 * the transcript. Headless/non-UI callers still fall back to ctx.ui.notify().
 */
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

export type InfoPanelSeverity = "info" | "warning" | "error" | "success";

export interface InfoPanelOptions {
  title: string;
  body: string;
  severity?: InfoPanelSeverity;
  footer?: string;
}

export async function openInfoPanel(
  ctx: ExtensionCommandContext,
  options: InfoPanelOptions,
): Promise<void> {
  const severity = options.severity ?? "info";
  const body = options.body.trim() || options.title;

  if (!ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }

  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) => {
      const panel = new InfoPanelComponent(theme, { ...options, body, severity }, done);
      return {
        render: (width: number) => panel.render(width),
        invalidate: () => panel.invalidate(),
        handleInput: (data: string) => panel.handleInput(data),
      };
    },
    {
      overlay: true,
      overlayOptions: {
        width: "72%",
        minWidth: 56,
        maxHeight: "80%",
        anchor: "center",
        margin: 2,
      },
    },
  );
}

class InfoPanelComponent {
  constructor(
    private readonly theme: Theme,
    private readonly options: Required<Pick<InfoPanelOptions, "title" | "body" | "severity">> &
      Pick<InfoPanelOptions, "footer">,
    private readonly done: () => void,
  ) {}

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "enter") ||
      matchesKey(data, "return") ||
      data === "q"
    ) {
      this.done();
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 4);
    const lines: string[] = [];
    const border = this.theme.fg("borderAccent", "─".repeat(Math.max(0, width - 2)));
    const title = this.severityIcon() + " " + this.options.title;

    lines.push(this.theme.fg("borderAccent", `┌${border}┐`));
    lines.push(this.pad(` ${this.theme.fg("accent", this.theme.bold(title))}`, width));
    lines.push(this.theme.fg("borderMuted", `├${"─".repeat(Math.max(0, width - 2))}┤`));

    for (const rawLine of this.options.body.split(/\r?\n/)) {
      if (!rawLine.trim()) {
        lines.push(this.pad("", width));
        continue;
      }
      for (const wrapped of wrapTextWithAnsi(rawLine, innerWidth)) {
        lines.push(this.pad(`  ${wrapped}`, width));
      }
    }

    lines.push(this.theme.fg("borderMuted", `├${"─".repeat(Math.max(0, width - 2))}┤`));
    lines.push(
      this.pad(
        ` ${this.theme.fg("dim", this.options.footer ?? "Enter/Esc return to the previous panel")}`,
        width,
      ),
    );
    lines.push(this.theme.fg("borderAccent", `└${border}┘`));
    return lines.map((line) => truncateToWidth(line, width, ""));
  }

  invalidate(): void {}

  private severityIcon(): string {
    if (this.options.severity === "success") return this.theme.fg("success", "✓");
    if (this.options.severity === "warning") return this.theme.fg("warning", "⚠");
    if (this.options.severity === "error") return this.theme.fg("error", "✗");
    return this.theme.fg("accent", "ⓘ");
  }

  private pad(content: string, width: number): string {
    return `${content}${" ".repeat(Math.max(0, width - visibleWidth(content)))}`;
  }
}
