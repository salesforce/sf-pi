/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Data Explorer defaults. */
import { Input, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  EXPLORER_MODES,
  readEffectiveDataExplorerSettings,
  writeScopedDataExplorerSettings,
  type DataExplorerSettingsScope,
} from "./settings.ts";
import type { ExplorerMode } from "./types.ts";

class DataExplorerConfigPanel implements Focusable {
  private input = new Input();
  private selected = 0;
  private defaultMode: ExplorerMode;
  private defaultOrg: string;
  private savedDefaultMode: ExplorerMode;
  private savedDefaultOrg: string;
  private savedSource: string;
  private editingOrg = false;
  private message = "";

  get focused(): boolean {
    return this.input.focused;
  }
  set focused(value: boolean) {
    this.input.focused = value;
  }

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: DataExplorerSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveDataExplorerSettings(cwd);
    this.defaultMode = effective.defaultMode;
    this.defaultOrg = effective.defaultOrg;
    this.savedDefaultMode = this.defaultMode;
    this.savedDefaultOrg = this.defaultOrg;
    this.savedSource =
      effective.source === "default" ? "default" : `${effective.source} (${effective.path})`;
    this.input.setValue(this.defaultOrg);
    this.input.onSubmit = (value) => this.commitOrg(value);
    this.input.onEscape = () => this.cancelOrgEdit();
  }

  handleInput(data: string): void {
    if (this.editingOrg) {
      this.input.handleInput(data);
      return;
    }
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      this.selected = this.selected === 0 ? 1 : 0;
      this.message = "";
      return;
    }
    if (
      this.selected === 0 &&
      (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space"))
    ) {
      this.cycleMode(matchesKey(data, "left") ? -1 : 1);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      if (this.selected === 1) this.startOrgEdit();
      else this.save();
      return;
    }
    if (data === "s") this.save();
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    if (this.editingOrg) {
      return [
        ` ${t.fg("accent", t.bold("SF Data Explorer Settings › Default org"))}`,
        "",
        ` ${t.fg("dim", "Enter a default target org alias or 'default'.")}`,
        "",
        ...this.input.render(Math.max(20, width - 4)).map((line) => ` ${line}`),
        "",
        ` ${t.fg("dim", "Enter save field · Esc cancel edit")}`,
      ];
    }
    const dirty = this.isDirty();
    const cursor = (index: number) => (this.selected === index ? t.fg("accent", "→") : " ");
    return [
      ` ${t.fg("accent", t.bold("SF Data Explorer Settings"))}`,
      ` ${t.fg("dim", "Defaults for direct /sf-data-explorer invocations.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.savedSource)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ` ${cursor(0)} ${t.fg(this.selected === 0 ? "accent" : "text", "Default mode".padEnd(18))} ${this.defaultMode}`,
      ` ${cursor(1)} ${t.fg(this.selected === 1 ? "accent" : "text", "Default org".padEnd(18))} ${this.defaultOrg}`,
      "",
      ...(this.message ? [` ${t.fg("success", this.message)}`] : []),
      ` ${t.fg("dim", "↑/↓ move · ←/→ change mode · Enter edit/save · S save · Esc back")}`,
    ];
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  private cycleMode(direction: -1 | 1): void {
    const current = EXPLORER_MODES.indexOf(this.defaultMode);
    this.defaultMode =
      EXPLORER_MODES[(current + direction + EXPLORER_MODES.length) % EXPLORER_MODES.length] ??
      this.defaultMode;
    this.message = "";
  }

  private startOrgEdit(): void {
    this.input.setValue(this.defaultOrg);
    this.input.focused = this.focused;
    this.editingOrg = true;
    this.message = "";
  }

  private commitOrg(value: string): void {
    this.defaultOrg = value.trim() || "default";
    this.editingOrg = false;
  }

  private cancelOrgEdit(): void {
    this.editingOrg = false;
    this.input.setValue(this.defaultOrg);
  }

  private save(): void {
    if (!this.isDirty()) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedDataExplorerSettings(this.cwd, this.scope, {
      defaultMode: this.defaultMode,
      defaultOrg: this.defaultOrg,
    });
    this.savedDefaultMode = saved.defaultMode;
    this.savedDefaultOrg = saved.defaultOrg;
    this.savedSource = `${saved.source} (${saved.path})`;
    this.message = "Saved Data Explorer settings.";
  }

  private isDirty(): boolean {
    return this.defaultMode !== this.savedDefaultMode || this.defaultOrg !== this.savedDefaultOrg;
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new DataExplorerConfigPanel(theme, cwd, scope, done);
};
