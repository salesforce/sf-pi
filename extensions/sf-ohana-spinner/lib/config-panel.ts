/* SPDX-License-Identifier: Apache-2.0 */
/** Config panel for the Ohana spinner mode preference. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  describeOhanaSpinnerSettingsSource,
  OHANA_SPINNER_MODES,
  readEffectiveOhanaSpinnerSettings,
  readScopedOhanaSpinnerSettings,
  writeScopedOhanaSpinnerSettings,
  type OhanaSpinnerMode,
  type OhanaSpinnerSettingsScope,
} from "./settings.ts";

class OhanaSpinnerConfigPanel implements Focusable {
  focused = false;

  private mode: OhanaSpinnerMode;
  private savedMode: OhanaSpinnerMode;
  private savedSource: string;
  private savedMessage = "";
  private reloadRequired = false;

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: OhanaSpinnerSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const scoped = readScopedOhanaSpinnerSettings(cwd, scope);
    const effective = readEffectiveOhanaSpinnerSettings(cwd);
    this.mode = scoped.exists ? scoped.settings.mode : effective.mode;
    this.savedMode = this.mode;
    this.savedSource = scoped.exists ? scoped.path : describeOhanaSpinnerSettingsSource(effective);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(this.reloadRequired ? { needsReload: true } : undefined);
      return;
    }

    if (matchesKey(data, "left") || matchesKey(data, "up")) {
      this.cycleMode(-1);
      return;
    }

    if (matchesKey(data, "right") || matchesKey(data, "down") || matchesKey(data, "space")) {
      this.cycleMode(1);
      return;
    }

    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.save();
    }
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.mode !== this.savedMode;
    const modeLine = OHANA_SPINNER_MODES.map((mode) => {
      const selected = mode === this.mode;
      const label = mode === "ohana" ? "Ohana" : "Calm";
      return t.fg(
        selected ? "accent" : "muted",
        selected ? `[ ${t.bold(label)} ]` : `  ${label}  `,
      );
    }).join(t.fg("dim", "  "));

    return [
      ` ${t.fg("muted", "Spinner Mode")}`,
      "",
      `  ${modeLine}`,
      "",
      `  ${t.fg("muted", "Ohana")} ${t.fg("dim", "Thinking… + rotating Salesforce messages")}`,
      `  ${t.fg("muted", "Calm")}  ${t.fg("dim", "stable Thinking… text")}`,
      "",
      `  ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      `  ${t.fg("muted", "Current source:")} ${t.fg("dim", this.savedSource)}`,
      ...(dirty ? [`  ${t.fg("warning", "Unsaved change — press Enter to save")}`] : []),
      ...(!dirty && this.savedMessage ? [`  ${t.fg("success", this.savedMessage)}`] : []),
      ...(this.reloadRequired
        ? [`  ${t.fg("warning", "Reload required — Esc back, then close the Manager to apply.")}`]
        : []),
      "",
      ` ${t.fg("dim", "←/→ change · Enter save · Esc back")}`,
    ];
  }

  render(): string[] {
    return this.renderContent();
  }

  invalidate(): void {}

  private cycleMode(direction: -1 | 1): void {
    const currentIndex = OHANA_SPINNER_MODES.indexOf(this.mode);
    const nextIndex =
      (currentIndex + direction + OHANA_SPINNER_MODES.length) % OHANA_SPINNER_MODES.length;
    this.mode = OHANA_SPINNER_MODES[nextIndex] ?? this.mode;
    this.savedMessage = "";
  }

  private save(): void {
    if (this.mode === this.savedMode) {
      this.savedMessage = "No changes to save.";
      return;
    }
    const saved = writeScopedOhanaSpinnerSettings(this.cwd, this.scope, { mode: this.mode });
    this.savedMode = saved.settings.mode;
    this.savedSource = saved.path;
    this.reloadRequired = true;
    this.savedMessage = "Saved spinner mode.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new OhanaSpinnerConfigPanel(theme, cwd, scope, done);
};
