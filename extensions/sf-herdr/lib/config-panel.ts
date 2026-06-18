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
  private savedWorkflowMode: HerdrWorkflowMode;
  private savedLaneStyle: HerdrLaneStyle;
  private savedSplitDirection: HerdrSplitDirection;
  private savedPreserveFocus: boolean;
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
    this.savedWorkflowMode = this.workflowMode;
    this.savedLaneStyle = this.laneStyle;
    this.savedSplitDirection = this.splitDirection;
    this.savedPreserveFocus = this.preserveFocus;
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
    if (data === "s" || data === "S" || matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.save();
    }
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.isDirty();
    const status = dirty ? t.fg("warning", "Unsaved changes") : t.fg("success", "Saved");
    const row = (index: number, label: string, value: string, changed: boolean) => {
      const selected = index === this.cursor;
      const marker = changed ? t.fg("warning", "•") : " ";
      const cursor = selected ? t.fg("accent", "›") : " ";
      const renderedValue = selected ? t.fg("accent", value) : t.fg("text", value);
      return ` ${cursor} ${marker} ${t.fg("muted", label.padEnd(16))} ${renderedValue}`;
    };
    return [
      ` ${t.fg("accent", t.bold("SF Herdr settings"))}  ${status}`,
      ` ${t.fg("dim", "Tune how SF Pi plans Herdr panes. Changes stay local until you save.")}`,
      "",
      row(0, "Workflow mode", this.workflowMode, this.workflowMode !== this.savedWorkflowMode),
      row(1, "Lane style", this.laneStyle, this.laneStyle !== this.savedLaneStyle),
      row(
        2,
        "Split direction",
        this.splitDirection,
        this.splitDirection !== this.savedSplitDirection,
      ),
      row(
        3,
        "Preserve focus",
        String(this.preserveFocus),
        this.preserveFocus !== this.savedPreserveFocus,
      ),
      "",
      ` ${t.fg("dim", "Workflow-specific lane profiles remain opinionated in v1.")}`,
      ` ${t.fg("dim", "↑/↓ select · ←/→/Space change · S/Enter save · Esc discard/back")}`,
    ];
  }

  render(): string[] {
    return this.renderContent();
  }

  invalidate(): void {}

  private toggleCurrent(): void {
    if (this.cursor === 0) this.workflowMode = this.workflowMode === "auto" ? "off" : "auto";
    if (this.cursor === 1) this.laneStyle = this.laneStyle === "split" ? "tab" : "split";
    if (this.cursor === 2) this.splitDirection = this.splitDirection === "right" ? "down" : "right";
    if (this.cursor === 3) this.preserveFocus = !this.preserveFocus;
  }

  private isDirty(): boolean {
    return (
      this.workflowMode !== this.savedWorkflowMode ||
      this.laneStyle !== this.savedLaneStyle ||
      this.splitDirection !== this.savedSplitDirection ||
      this.preserveFocus !== this.savedPreserveFocus
    );
  }

  private save(): void {
    if (!this.isDirty()) {
      this.done(undefined);
      return;
    }
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

export const createConfigPanel: ConfigPanelFactory = (theme, _cwd, _scope, done) => {
  return new SfHerdrConfigPanel(theme, done);
};
