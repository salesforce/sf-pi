/* SPDX-License-Identifier: Apache-2.0 */
/** Config panel for SF Herdr managed preferences. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  LANE_IDS,
  WORKFLOW_KEYS,
  readSfHerdrPreferences,
  writeSfHerdrPreferences,
  type HerdrLaneId,
  type HerdrLaneLifecycle,
  type HerdrLaneStyle,
  type HerdrSplitDirection,
  type HerdrWorkflowKey,
  type SfHerdrPreferences,
} from "../../../lib/common/herdr-profile/store.ts";

const LIFECYCLES: readonly HerdrLaneLifecycle[] = ["ephemeral", "sticky", "manual"];

class SfHerdrConfigPanel implements Focusable {
  focused = false;

  private preferences: SfHerdrPreferences;
  private savedSnapshot: string;
  private cursor = 0;
  private workflowIndex = 0;
  private laneIndex = 0;
  private savedMessage = "";

  constructor(
    private readonly theme: Theme,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    this.preferences = readSfHerdrPreferences();
    this.savedSnapshot = snapshot(this.preferences);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up")) {
      this.moveCursor(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.moveCursor(1);
      return;
    }
    if (matchesKey(data, "left")) {
      this.changeCurrent(-1);
      return;
    }
    if (matchesKey(data, "right") || matchesKey(data, "space")) {
      this.changeCurrent(1);
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
    const workflow = this.selectedWorkflow();
    const lane = this.selectedLane();
    const lanePrefs = this.currentLanePreferences();
    const row = (index: number, label: string, value: string, changed: boolean) => {
      const selected = index === this.cursor;
      const marker = changed ? t.fg("warning", "•") : " ";
      const cursor = selected ? t.fg("accent", "›") : " ";
      const renderedValue = selected ? t.fg("accent", value) : t.fg("text", value);
      return ` ${cursor} ${marker} ${t.fg("muted", label.padEnd(18))} ${renderedValue}`;
    };
    const lines = [
      ` ${t.fg("accent", t.bold("SF Herdr settings"))}  ${status}`,
      ` ${t.fg("dim", "Tune how SF Pi plans Herdr panes. Changes stay local until you save.")}`,
      "",
      row(0, "Workflow mode", this.preferences.workflowMode, this.changed("workflowMode")),
      row(
        1,
        "Lane style",
        String(this.preferences.defaults.laneStyle ?? "split"),
        this.changed("laneStyle"),
      ),
      row(
        2,
        "Split direction",
        String(this.preferences.defaults.splitDirection ?? "right"),
        this.changed("splitDirection"),
      ),
      row(
        3,
        "Preserve focus",
        String(this.preferences.defaults.preserveFocus ?? true),
        this.changed("preserveFocus"),
      ),
      "",
      ` ${t.fg("muted", t.bold("Workflow lane profile"))}`,
      row(4, "Workflow", workflow, false),
      row(5, "Lane", lane, false),
      row(6, "Lane enabled", String(lanePrefs.enabled ?? true), this.currentLaneChanged()),
      row(7, "Lane lifecycle", lanePrefs.lifecycle ?? "ephemeral", this.currentLaneChanged()),
      "",
    ];
    if (this.savedMessage) lines.push(` ${t.fg("success", this.savedMessage)}`);
    lines.push(
      ` ${t.fg("dim", "↑/↓ select · ←/→/Space change · S/Enter save · Esc discard/back")}`,
    );
    return lines;
  }

  render(): string[] {
    return this.renderContent();
  }

  invalidate(): void {}

  private moveCursor(delta: -1 | 1): void {
    this.cursor = (this.cursor + delta + 8) % 8;
    this.savedMessage = "";
  }

  private changeCurrent(delta: -1 | 1): void {
    switch (this.cursor) {
      case 0:
        this.preferences.workflowMode = this.preferences.workflowMode === "auto" ? "off" : "auto";
        break;
      case 1:
        this.preferences.defaults.laneStyle = this.currentLaneStyle() === "split" ? "tab" : "split";
        break;
      case 2:
        this.preferences.defaults.splitDirection =
          this.currentSplitDirection() === "right" ? "down" : "right";
        break;
      case 3:
        this.preferences.defaults.preserveFocus = !this.currentPreserveFocus();
        break;
      case 4:
        this.workflowIndex = cycleIndex(this.workflowIndex, WORKFLOW_KEYS.length, delta);
        break;
      case 5:
        this.laneIndex = cycleIndex(this.laneIndex, LANE_IDS.length, delta);
        break;
      case 6:
        this.currentLanePreferences().enabled = !(this.currentLanePreferences().enabled ?? true);
        break;
      case 7:
        this.currentLanePreferences().lifecycle = cycleValue(
          LIFECYCLES,
          this.currentLanePreferences().lifecycle ?? "ephemeral",
          delta,
        );
        break;
    }
    this.savedMessage = "";
  }

  private isDirty(): boolean {
    return snapshot(this.preferences) !== this.savedSnapshot;
  }

  private changed(key: "workflowMode" | "laneStyle" | "splitDirection" | "preserveFocus"): boolean {
    const saved = JSON.parse(this.savedSnapshot) as SfHerdrPreferences;
    if (key === "workflowMode") return this.preferences.workflowMode !== saved.workflowMode;
    if (key === "laneStyle") {
      return (
        (this.preferences.defaults.laneStyle ?? "split") !== (saved.defaults.laneStyle ?? "split")
      );
    }
    if (key === "splitDirection") {
      return (
        (this.preferences.defaults.splitDirection ?? "right") !==
        (saved.defaults.splitDirection ?? "right")
      );
    }
    return (
      (this.preferences.defaults.preserveFocus ?? true) !== (saved.defaults.preserveFocus ?? true)
    );
  }

  private currentLaneChanged(): boolean {
    const saved = JSON.parse(this.savedSnapshot) as SfHerdrPreferences;
    const workflow = this.selectedWorkflow();
    const lane = this.selectedLane();
    const current = this.preferences.workflows[workflow]?.lanes?.[lane] ?? {};
    const previous = saved.workflows[workflow]?.lanes?.[lane] ?? {};
    return JSON.stringify(current) !== JSON.stringify(previous);
  }

  private save(): void {
    if (!this.isDirty()) {
      this.savedMessage = "No changes to save.";
      return;
    }
    writeSfHerdrPreferences(this.preferences);
    this.preferences = readSfHerdrPreferences();
    this.savedSnapshot = snapshot(this.preferences);
    this.savedMessage = "Saved SF Herdr settings.";
  }

  private currentLaneStyle(): HerdrLaneStyle {
    return this.preferences.defaults.laneStyle ?? "split";
  }

  private currentSplitDirection(): HerdrSplitDirection {
    return this.preferences.defaults.splitDirection ?? "right";
  }

  private currentPreserveFocus(): boolean {
    return this.preferences.defaults.preserveFocus ?? true;
  }

  private selectedWorkflow(): HerdrWorkflowKey {
    return WORKFLOW_KEYS[this.workflowIndex] ?? "generic";
  }

  private selectedLane(): HerdrLaneId {
    return LANE_IDS[this.laneIndex] ?? "tests";
  }

  private currentLanePreferences() {
    const workflow = this.selectedWorkflow();
    const lane = this.selectedLane();
    this.preferences.workflows[workflow] ??= {};
    this.preferences.workflows[workflow].lanes ??= {};
    this.preferences.workflows[workflow].lanes[lane] ??= {};
    return this.preferences.workflows[workflow].lanes[lane];
  }
}

function snapshot(preferences: SfHerdrPreferences): string {
  return JSON.stringify(preferences);
}

function cycleIndex(index: number, length: number, delta: -1 | 1): number {
  return (index + delta + length) % length;
}

function cycleValue<T extends string>(values: readonly T[], current: T, delta: -1 | 1): T {
  const index = Math.max(0, values.indexOf(current));
  return values[cycleIndex(index, values.length, delta)] ?? current;
}

export const createConfigPanel: ConfigPanelFactory = (theme, _cwd, _scope, done) => {
  return new SfHerdrConfigPanel(theme, done);
};
