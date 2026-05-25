/* SPDX-License-Identifier: Apache-2.0 */
/** Config panel for SF Herdr managed preferences. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  readSfHerdrPreferences,
  writeSfHerdrPreferences,
  type HerdrLaneStyle,
  type HerdrSplitDirection,
  type HerdrWorkflowMode,
} from "../../../lib/common/herdr-profile/store.ts";

class SfHerdrConfigPanel implements Focusable {
  focused = false;

  private workflowMode: HerdrWorkflowMode;
  private laneStyle: HerdrLaneStyle;
  private splitDirection: HerdrSplitDirection;
  private preserveFocus: boolean;
  private cursor = 0;

  constructor(
    private readonly theme: Theme,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const preferences = readSfHerdrPreferences();
    this.workflowMode = preferences.workflowMode;
    this.laneStyle = preferences.defaults.laneStyle ?? "split";
    this.splitDirection = preferences.defaults.splitDirection ?? "right";
    this.preserveFocus = preferences.defaults.preserveFocus ?? true;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up")) {
      this.cursor = (this.cursor + 3) % 4;
      return;
    }
    if (matchesKey(data, "down")) {
      this.cursor = (this.cursor + 1) % 4;
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.toggleCurrent();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      const preferences = readSfHerdrPreferences();
      writeSfHerdrPreferences({
        ...preferences,
        workflowMode: this.workflowMode,
        defaults: {
          ...preferences.defaults,
          laneStyle: this.laneStyle,
          splitDirection: this.splitDirection,
          preserveFocus: this.preserveFocus,
        },
      });
      this.done({ needsReload: true });
    }
  }

  renderContent(_width: number): string[] {
    const t = this.theme;
    const row = (index: number, label: string, value: string) => {
      const selected = index === this.cursor;
      return ` ${selected ? t.fg("accent", "›") : " "} ${t.fg("muted", label.padEnd(16))} ${selected ? t.fg("accent", value) : t.fg("text", value)}`;
    };
    return [
      ` ${t.fg("muted", "SF Herdr — managed workflow preferences")}`,
      "",
      row(0, "Workflow mode", this.workflowMode),
      row(1, "Lane style", this.laneStyle),
      row(2, "Split direction", this.splitDirection),
      row(3, "Preserve focus", String(this.preserveFocus)),
      "",
      ` ${t.fg("dim", "These defaults feed sf_herdr_plan. Per-workflow profiles use opinionated defaults in v1.")}`,
      ` ${t.fg("dim", "↑/↓ select · ←/→/Space change · Enter save · Esc back")}`,
    ];
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private toggleCurrent(): void {
    if (this.cursor === 0) this.workflowMode = this.workflowMode === "auto" ? "off" : "auto";
    if (this.cursor === 1) this.laneStyle = this.laneStyle === "split" ? "tab" : "split";
    if (this.cursor === 2) this.splitDirection = this.splitDirection === "right" ? "down" : "right";
    if (this.cursor === 3) this.preserveFocus = !this.preserveFocus;
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, _cwd, _scope, done) => {
  return new SfHerdrConfigPanel(theme, done);
};
