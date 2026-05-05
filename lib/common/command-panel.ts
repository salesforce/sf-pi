/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared grouped command panel for SF Pi extension commands.
 *
 * Pi's stock SelectList is intentionally flat: label + description rows with
 * no non-selectable group headers. SF Pi command surfaces need the same native
 * `ctx.ui.custom()`/DynamicBorder feel, but with grouped actions and a
 * full-width selected-action description so long help text does not clip.
 */
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  type KeybindingsManager,
  matchesKey,
  Spacer,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";

export interface CommandPanelAction<T extends string = string> {
  value: T;
  label: string;
  description: string;
  group: string;
}

export interface CommandPanelOptions<T extends string = string> {
  title: string;
  statusLines?: string[];
  actions: CommandPanelAction<T>[];
  closeValue: T;
  statusHeading?: string;
  actionsHeading?: string;
  helpText?: string;
}

export async function openCommandPanel<T extends string>(
  ctx: ExtensionCommandContext,
  options: CommandPanelOptions<T>,
): Promise<T | null> {
  const result = await ctx.ui.custom<T | null>((tui, theme, keybindings, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(options.title)), 1, 0));

    if (options.statusLines && options.statusLines.length > 0) {
      container.addChild(new Spacer(1));
      container.addChild(
        new Text(theme.fg("muted", ` ${options.statusHeading ?? "Status"}`), 1, 0),
      );
      for (const line of options.statusLines) {
        container.addChild(new Text(line, 1, 0));
      }
    }

    container.addChild(new Spacer(1));
    container.addChild(
      new Text(theme.fg("muted", ` ${options.actionsHeading ?? "Actions"}`), 1, 0),
    );
    const list = new GroupedActionList(
      theme,
      keybindings,
      options.actions,
      options.closeValue,
      done,
    );
    container.addChild(list);

    container.addChild(new Spacer(1));
    container.addChild(
      new Text(
        theme.fg(
          "dim",
          options.helpText ??
            "↑↓ navigate • type filter • backspace edit • enter run • actions return here • esc close",
        ),
        1,
        0,
      ),
    );
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

class GroupedActionList<T extends string> {
  private filter = "";
  private selectedIndex = 0;

  constructor(
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly items: CommandPanelAction<T>[],
    private readonly closeValue: T,
    private readonly done: (result: T | null) => void,
  ) {}

  render(width: number): string[] {
    const lines: string[] = [];
    const filtered = this.filteredItems();

    if (this.filter) {
      lines.push(
        truncateToWidth(
          ` ${this.theme.fg("muted", "Filter:")} ${this.theme.fg("accent", this.filter)} ${this.theme.fg("dim", `(${filtered.length}/${this.items.length})`)}`,
          width,
          "",
        ),
      );
    }

    if (filtered.length === 0) {
      lines.push(this.theme.fg("warning", "  No matching actions"));
      lines.push(this.theme.fg("dim", "  Backspace edits the filter; Esc closes the panel."));
      return lines;
    }

    this.selectedIndex = Math.min(this.selectedIndex, filtered.length - 1);
    let currentGroup: string | undefined;
    for (let i = 0; i < filtered.length; i++) {
      const item = filtered[i];
      if (!item) continue;
      if (item.group !== currentGroup) {
        currentGroup = item.group;
        lines.push(` ${this.theme.fg("muted", currentGroup)}`);
      }
      lines.push(this.renderActionLine(item, i === this.selectedIndex, width));
    }

    const selected = filtered[this.selectedIndex];
    if (selected) {
      lines.push("");
      lines.push(
        truncateToWidth(
          ` ${this.theme.fg("muted", "Selected:")} ${this.theme.fg("accent", selected.label)}`,
          width,
          "",
        ),
      );
      for (const wrapped of wrapTextWithAnsi(selected.description, Math.max(20, width - 4))) {
        lines.push(`   ${this.theme.fg("dim", wrapped)}`);
      }
    }

    return lines;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.move(-1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      this.move(1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const selected = this.filteredItems()[this.selectedIndex];
      if (selected) this.done(selected.value);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.done(this.closeValue);
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.filter = this.filter.slice(0, -1);
      this.selectedIndex = 0;
      return;
    }
    if (isPrintableFilterInput(data)) {
      this.filter += data;
      this.selectedIndex = 0;
    }
  }

  private renderActionLine(item: CommandPanelAction<T>, selected: boolean, width: number): string {
    const marker = selected ? this.theme.fg("accent", "→") : this.theme.fg("dim", " ");
    const label = selected ? this.theme.fg("accent", this.theme.bold(item.label)) : item.label;
    return truncateToWidth(` ${marker} ${label}`, width, "");
  }

  private move(delta: number): void {
    const len = this.filteredItems().length;
    if (len === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + len) % len;
  }

  private filteredItems(): CommandPanelAction<T>[] {
    const needle = this.filter.trim().toLowerCase();
    if (!needle) return this.items;
    return this.items.filter((item) =>
      `${item.group} ${item.label} ${item.description} ${item.value}`
        .toLowerCase()
        .includes(needle),
    );
  }
}

function isPrintableFilterInput(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}
