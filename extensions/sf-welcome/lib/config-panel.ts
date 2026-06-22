/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Welcome startup surface. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  readEffectiveWelcomeSettings,
  writeScopedWelcomeSettings,
  type WelcomeStartupMode,
  type WelcomeSettingsScope,
} from "./welcome-settings.ts";

class SfWelcomeConfigPanel implements Focusable {
  focused = false;

  private mode: WelcomeStartupMode;
  private savedMode: WelcomeStartupMode;
  private savedSource: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: WelcomeSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveWelcomeSettings(cwd);
    this.mode = effective.startupMode;
    this.savedMode = this.mode;
    this.savedSource =
      effective.source === "default" ? "default" : `${effective.source} (${effective.path})`;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.mode = this.mode === "header" ? "overlay" : "header";
      this.message = "";
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") {
      this.save();
    }
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.mode !== this.savedMode;
    return [
      ` ${t.fg("accent", t.bold("SF Welcome Settings"))}`,
      ` ${t.fg("dim", "Tune the startup welcome surface. --verbose still forces the full overlay.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.savedSource)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ` ${t.fg("muted", "Startup surface")} ${t.fg(dirty ? "accent" : "text", this.mode)}`,
      `   ${t.fg("dim", "header = compact non-blocking startup; overlay = full splash when not quiet.")}`,
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
    if (this.mode === this.savedMode) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedWelcomeSettings(this.cwd, this.scope, { startupMode: this.mode });
    this.savedMode = saved.startupMode;
    this.savedSource = `${saved.source} (${saved.path})`;
    this.message = "Saved Welcome settings.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfWelcomeConfigPanel(theme, cwd, scope, done);
};
