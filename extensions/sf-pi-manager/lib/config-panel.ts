/* SPDX-License-Identifier: Apache-2.0 */
/** Config panel for core sf-pi settings. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  readAutoUpdateEnabled,
  readAutoUpdateStatus,
  writeAutoUpdateEnabled,
} from "../../../lib/common/auto-update/store.ts";
import {
  describeDisplaySettingsSource,
  readEffectiveSfPiDisplaySettings,
  readScopedSfPiDisplaySettings,
  writeScopedSfPiDisplaySettings,
  type SfPiSettingsScope,
} from "../../../lib/common/display/settings.ts";
import {
  SF_PI_DISPLAY_PROFILES,
  type SfPiDisplayProfile,
} from "../../../lib/common/display/types.ts";
import { padAnsi, wrapPlainText } from "./render.ts";

type SettingsRow = "auto-update" | "display";

class SfPiManagerConfigPanel implements Focusable {
  focused = false;

  private profile: SfPiDisplayProfile;
  private savedProfile: SfPiDisplayProfile;
  private savedSource: string;
  private autoUpdateEnabled: boolean;
  private savedAutoUpdateEnabled: boolean;
  private selectedRow: SettingsRow = "display";
  private savedMessage = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: SfPiSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const scoped = readScopedSfPiDisplaySettings(cwd, scope);
    const effective = readEffectiveSfPiDisplaySettings(cwd);
    this.profile = scoped.exists ? scoped.settings.profile : effective.profile;
    this.savedProfile = this.profile;
    this.savedSource = scoped.exists ? scoped.path : describeDisplaySettingsSource(effective);
    this.autoUpdateEnabled = readAutoUpdateEnabled();
    this.savedAutoUpdateEnabled = this.autoUpdateEnabled;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, "up") || matchesKey(data, "down") || matchesKey(data, "tab")) {
      this.toggleSelectedRow();
      return;
    }

    if (matchesKey(data, "left")) {
      this.cycleProfile(-1);
      return;
    }

    if (matchesKey(data, "right")) {
      this.cycleProfile(1);
      return;
    }

    if (matchesKey(data, "space")) {
      if (this.selectedRow === "auto-update") this.toggleAutoUpdate();
      else this.cycleProfile(1);
      return;
    }

    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.save();
    }
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const pad = (content = "") => padAnsi(content, width);

    lines.push(pad(` ${t.fg("muted", "SF Pi Manager Settings")}`));
    lines.push(pad(""));

    const autoCursor = this.selectedRow === "auto-update" ? t.fg("accent", ">") : " ";
    const autoBox = this.autoUpdateEnabled ? "[✓]" : "[ ]";
    lines.push(
      pad(` ${autoCursor} ${t.fg("accent", autoBox)} ${t.bold("Enable daily native auto-update")}`),
    );
    for (const line of wrapPlainText(
      "When enabled, SF Pi tries once per day after startup, only if Pi is idle. It runs exactly: pi update --all, then sf update stable. It never restarts pi automatically.",
      Math.max(20, width - 5),
    )) {
      lines.push(pad(`    ${t.fg("dim", line)}`));
    }
    const autoStatus = readAutoUpdateStatus();
    lines.push(pad(`    ${t.fg("muted", "Last run:")} ${autoStatus.lastRunAt ?? "never"}`));
    lines.push(pad(`    ${t.fg("muted", "Last result:")} ${autoStatus.lastResult ?? "—"}`));
    lines.push(pad(`    ${t.fg("muted", "Machine scope:")} global settings`));
    lines.push(pad(""));

    const displayCursor = this.selectedRow === "display" ? t.fg("accent", ">") : " ";
    lines.push(pad(` ${displayCursor} ${t.fg("muted", "Shared Display Profile")}`));
    for (const line of wrapPlainText(
      "Controls sf-pi's default verbosity contract when no tool-specific preference overrides it.",
      Math.max(20, width - 5),
    )) {
      lines.push(pad(`    ${t.fg("dim", line)}`));
    }
    lines.push(pad(""));

    const profileLine = SF_PI_DISPLAY_PROFILES.map((profile) => {
      const selected = profile === this.profile;
      const label = selected ? t.bold(profile) : profile;
      return t.fg(selected ? "accent" : "muted", selected ? `[ ${label} ]` : `  ${label}  `);
    }).join(t.fg("dim", "  "));
    lines.push(pad(`    ${profileLine}`));
    lines.push(pad(""));

    lines.push(
      pad(
        `    ${t.fg("muted", "compact")}  ${t.fg("dim", "terse summaries and minimal previews")}`,
      ),
    );
    lines.push(
      pad(
        `    ${t.fg("muted", "balanced")} ${t.fg("dim", "concise defaults with useful previews")}`,
      ),
    );
    lines.push(
      pad(
        `    ${t.fg("muted", "verbose")}  ${t.fg("dim", "richer previews and fuller research detail")}`,
      ),
    );
    lines.push(pad(""));
    const dirty = this.isDirty();
    lines.push(pad(`  ${t.fg("muted", "Display scope:")} ${t.fg("text", this.scope)}`));
    lines.push(pad(`  ${t.fg("muted", "Display source:")} ${t.fg("dim", this.savedSource)}`));
    if (dirty) lines.push(pad(`  ${t.fg("warning", "Unsaved change — press Enter to save")}`));
    else if (this.savedMessage) lines.push(pad(`  ${t.fg("success", this.savedMessage)}`));
    lines.push(pad(""));
    lines.push(
      pad(
        ` ${t.fg("dim", "↑/↓ select · Space toggle/cycle · ←/→ profile · Enter save · Esc back")}`,
      ),
    );

    return lines;
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private toggleSelectedRow(): void {
    this.selectedRow = this.selectedRow === "auto-update" ? "display" : "auto-update";
    this.savedMessage = "";
  }

  private toggleAutoUpdate(): void {
    this.autoUpdateEnabled = !this.autoUpdateEnabled;
    this.savedMessage = "";
  }

  private cycleProfile(direction: -1 | 1): void {
    const currentIndex = SF_PI_DISPLAY_PROFILES.indexOf(this.profile);
    const nextIndex =
      (currentIndex + direction + SF_PI_DISPLAY_PROFILES.length) % SF_PI_DISPLAY_PROFILES.length;
    this.profile = SF_PI_DISPLAY_PROFILES[nextIndex] ?? this.profile;
    this.savedMessage = "";
  }

  private isDirty(): boolean {
    return (
      this.profile !== this.savedProfile || this.autoUpdateEnabled !== this.savedAutoUpdateEnabled
    );
  }

  private save(): void {
    if (!this.isDirty()) {
      this.savedMessage = "No changes to save.";
      return;
    }

    if (this.profile !== this.savedProfile) {
      const saved = writeScopedSfPiDisplaySettings(this.cwd, this.scope, { profile: this.profile });
      this.savedProfile = saved.settings.profile;
      this.savedSource = saved.path;
    }

    if (this.autoUpdateEnabled !== this.savedAutoUpdateEnabled) {
      writeAutoUpdateEnabled(this.autoUpdateEnabled);
      this.savedAutoUpdateEnabled = this.autoUpdateEnabled;
    }

    this.savedMessage = "Saved settings.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfPiManagerConfigPanel(theme, cwd, scope, done);
};
