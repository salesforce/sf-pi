/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Skills preferences. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  readEffectiveSfSkillsSettings,
  writeScopedSfSkillsSettings,
  type SfSkillsSettings,
  type SkillsSettingsScope,
} from "./settings.ts";

class SfSkillsConfigPanel implements Focusable {
  focused = false;
  private cursor = 0;
  private draft: SfSkillsSettings;
  private saved: SfSkillsSettings;
  private source: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: SkillsSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveSfSkillsSettings(cwd);
    this.draft = { ...effective };
    this.saved = { ...this.draft };
    this.source =
      effective.source === "default" ? "default" : `${effective.source} (${effective.path})`;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      this.cursor = this.cursor === 0 ? 1 : 0;
      this.message = "";
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.toggleCurrent();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") this.save();
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.isDirty();
    const row = (index: number, label: string, value: string, detail: string) => {
      const selected = this.cursor === index;
      return [
        ` ${selected ? t.fg("accent", "→") : " "} ${t.fg(selected ? "accent" : "text", label.padEnd(22))} ${t.fg("muted", value)}`,
        `    ${t.fg("dim", detail)}`,
      ];
    };
    return [
      ` ${t.fg("accent", t.bold("SF Skills Settings"))}`,
      ` ${t.fg("dim", "Tune passive HUD behavior and default managed-skill wiring scope.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.source)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ...row(
        0,
        "HUD visibility",
        this.draft.hudVisibility,
        "auto shows the passive HUD when skills are in context; hidden suppresses it.",
      ),
      ...row(
        1,
        "Default install scope",
        this.draft.defaultInstallScope,
        "Used by /sf-skills defaults install/update when no scope is specified.",
      ),
      "",
      ...(this.message ? [` ${t.fg("success", this.message)}`] : []),
      ` ${t.fg("dim", "↑/↓ move · ←/→ toggle · S/Enter save · Esc back")}`,
    ];
  }

  render(): string[] {
    return this.renderContent();
  }

  invalidate(): void {}

  private toggleCurrent(): void {
    if (this.cursor === 0) {
      this.draft.hudVisibility = this.draft.hudVisibility === "auto" ? "hidden" : "auto";
    } else {
      this.draft.defaultInstallScope =
        this.draft.defaultInstallScope === "project" ? "global" : "project";
    }
    this.message = "";
  }

  private isDirty(): boolean {
    return JSON.stringify(this.draft) !== JSON.stringify(this.saved);
  }

  private save(): void {
    if (!this.isDirty()) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedSfSkillsSettings(this.cwd, this.scope, this.draft);
    this.saved = {
      hudVisibility: saved.hudVisibility,
      defaultInstallScope: saved.defaultInstallScope,
    };
    this.source = `${saved.source} (${saved.path})`;
    this.message = "Saved SF Skills settings.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfSkillsConfigPanel(theme, cwd, scope, done);
};
