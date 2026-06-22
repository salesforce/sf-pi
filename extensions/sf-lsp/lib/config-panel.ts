/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for sf-lsp UI preferences. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  readEffectiveSfLspSettings,
  readScopedSfLspSettings,
  writeScopedSfLspSettings,
  type SfLspSettingsScope,
} from "./settings-io.ts";

class SfLspConfigPanel implements Focusable {
  focused = false;

  private verbose: boolean;
  private savedVerbose: boolean;
  private savedSource: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: SfLspSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const scoped = readScopedSfLspSettings(cwd, scope);
    const effective = readEffectiveSfLspSettings(cwd);
    this.verbose = scoped.exists ? scoped.settings.verbose : effective.verbose;
    this.savedVerbose = this.verbose;
    this.savedSource = scoped.exists ? scoped.path : sourceLabel(effective);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.verbose = !this.verbose;
      this.message = "";
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") {
      this.save();
    }
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.verbose !== this.savedVerbose;
    return [
      ` ${t.fg("accent", t.bold("SF LSP Settings"))}`,
      ` ${t.fg("dim", "Tune user-visible LSP diagnostics. Diagnostic feedback to the agent is unchanged.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.savedSource)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ` ${t.fg("muted", "Verbose transcript rows")} ${t.fg(dirty ? "accent" : "text", this.verbose ? "on" : "off")}`,
      `   ${t.fg("dim", "When on, emit a user-visible transcript row for every LSP check.")}`,
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
    if (this.verbose === this.savedVerbose) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedSfLspSettings(this.cwd, this.scope, { verbose: this.verbose });
    this.savedVerbose = saved.verbose;
    this.savedSource = saved.path ?? this.scope;
    this.message = "Saved LSP settings.";
  }
}

function sourceLabel(settings: ReturnType<typeof readEffectiveSfLspSettings>): string {
  if (settings.source === "default") return "default";
  return `${settings.source} (${settings.path})`;
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfLspConfigPanel(theme, cwd, scope, done);
};
