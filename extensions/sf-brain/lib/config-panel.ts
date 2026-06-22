/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Brain preferences. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  readEffectiveSfBrainSettings,
  writeScopedSfBrainSettings,
  type HerdrGuidanceMode,
  type SfBrainSettingsScope,
} from "./settings.ts";

class SfBrainConfigPanel implements Focusable {
  focused = false;
  private herdrGuidance: HerdrGuidanceMode;
  private savedHerdrGuidance: HerdrGuidanceMode;
  private source: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: SfBrainSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveSfBrainSettings(cwd);
    this.herdrGuidance = effective.herdrGuidance;
    this.savedHerdrGuidance = this.herdrGuidance;
    this.source =
      effective.source === "default" ? "default" : `${effective.source} (${effective.path})`;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.herdrGuidance = this.herdrGuidance === "auto" ? "off" : "auto";
      this.message = "";
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") this.save();
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.herdrGuidance !== this.savedHerdrGuidance;
    return [
      ` ${t.fg("accent", t.bold("SF Brain Settings"))}`,
      ` ${t.fg("dim", "Tune optional operator-kernel context additions. Core Salesforce safety guidance stays enabled while the extension is enabled.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.source)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ` ${t.fg("muted", "Herdr workflow guidance")} ${t.fg(dirty ? "accent" : "text", this.herdrGuidance)}`,
      `   ${t.fg("dim", "auto includes Herdr workflow guidance only inside an active Herdr pane; off omits that add-on.")}`,
      "",
      ...(this.message ? [` ${t.fg("success", this.message)}`] : []),
      ` ${t.fg("dim", "←/→ toggle · S/Enter save · Esc back")}`,
    ];
  }
  render(): string[] {
    return this.renderContent();
  }
  invalidate(): void {}

  private save(): void {
    if (this.herdrGuidance === this.savedHerdrGuidance) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedSfBrainSettings(this.cwd, this.scope, {
      herdrGuidance: this.herdrGuidance,
    });
    this.savedHerdrGuidance = saved.herdrGuidance;
    this.source = `${saved.source} (${saved.path})`;
    this.message = "Saved SF Brain settings.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) =>
  new SfBrainConfigPanel(theme, cwd, scope, done);
