/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Top-right passive overlay for the SF Skills HUD.
 *
 * The component never captures input. Pi keeps it anchored to the viewport while
 * chat content scrolls underneath.
 */
import type { Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import type { TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SkillsHudState } from "./skill-state.ts";

export class SkillsHudComponent {
  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private state: SkillsHudState,
  ) {}

  setState(state: SkillsHudState): void {
    this.state = state;
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(24, width - 2);
    const lines: string[] = [];

    const row = (content = "") => {
      const truncated = truncateToWidth(content, innerWidth, "", true);
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(truncated)));
      return `${this.theme.fg("border", "│")}${truncated}${padding}${this.theme.fg("border", "│")}`;
    };

    lines.push(this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));

    const title = this.theme.fg("accent", this.theme.bold("🔒 SF Skills HUD"));
    const summary = this.theme.fg("dim", buildSummaryText(this.state));
    const gap = Math.max(1, innerWidth - visibleWidth(title) - visibleWidth(summary));
    lines.push(row(`${title}${" ".repeat(gap)}${summary}`));

    if (this.state.live.length > 0) {
      lines.push(
        ...renderSection(
          this.theme,
          row,
          "Live",
          this.state.live.map((skill) => skill.name),
          "accent",
          innerWidth,
        ),
      );
    }

    if (this.state.earlier.length > 0) {
      if (this.state.live.length > 0) {
        lines.push(row(""));
      }
      lines.push(
        ...renderSection(
          this.theme,
          row,
          "Earlier",
          this.state.earlier.map((skill) => skill.name),
          "warning",
          innerWidth,
        ),
      );
    }

    lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}

  dispose(): void {}
}

function buildSummaryText(state: SkillsHudState): string {
  const parts: string[] = [];

  if (state.live.length > 0) {
    parts.push(`${state.live.length} live`);
  }

  if (state.earlier.length > 0) {
    parts.push(`${state.earlier.length} earlier`);
  }

  return parts.join(" · ");
}

function renderSection(
  theme: Theme,
  row: (content?: string) => string,
  label: string,
  names: string[],
  accentColor: ThemeColor,
  width: number,
): string[] {
  const wrapped = wrapSkillList(`${label}: `, names, width);
  return wrapped.map((line, index) => {
    if (index === 0) {
      const prefix = `${label}: `;
      const content = line.slice(prefix.length);
      return row(`${theme.fg(accentColor, prefix)}${content}`);
    }
    return row(line);
  });
}

function wrapSkillList(prefix: string, names: string[], width: number): string[] {
  const indent = " ".repeat(prefix.length);
  const lines: string[] = [];
  let current = prefix;

  for (let index = 0; index < names.length; index++) {
    const isLast = index === names.length - 1;
    const token = isLast ? names[index] : `${names[index]}, `;

    if (visibleWidth(current + token) <= width) {
      current += token;
      continue;
    }

    lines.push(current.trimEnd());
    current = indent + token;
  }

  lines.push(current.trimEnd());
  return lines;
}
