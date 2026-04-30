/* SPDX-License-Identifier: Apache-2.0 */
/** Config panel for core sf-pi display settings. */
import { type Focusable, matchesKey } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
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

class SfPiManagerConfigPanel implements Focusable {
  focused = false;

  private profile: SfPiDisplayProfile;
  private savedProfile: SfPiDisplayProfile;
  private savedSource: string;

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
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
      return;
    }

    if (matchesKey(data, "left") || matchesKey(data, "up")) {
      this.cycleProfile(-1);
      return;
    }

    if (matchesKey(data, "right") || matchesKey(data, "down") || matchesKey(data, "space")) {
      this.cycleProfile(1);
      return;
    }

    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.save();
      this.done(undefined);
    }
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const pad = (content = "") => padAnsi(content, width);

    lines.push(pad(` ${t.fg("muted", "Shared Display Profile")}`));
    lines.push(pad(""));
    for (const line of wrapPlainText(
      "Controls sf-pi's default verbosity contract. Extensions use it to choose compact summaries, balanced previews, or verbose detail when no tool-specific preference overrides it.",
      Math.max(20, width - 3),
    )) {
      lines.push(pad(`  ${t.fg("dim", line)}`));
    }
    lines.push(pad(""));

    const profileLine = SF_PI_DISPLAY_PROFILES.map((profile) => {
      const selected = profile === this.profile;
      const label = selected ? t.bold(profile) : profile;
      return t.fg(selected ? "accent" : "muted", selected ? `[ ${label} ]` : `  ${label}  `);
    }).join(t.fg("dim", "  "));
    lines.push(pad(`  ${profileLine}`));
    lines.push(pad(""));

    lines.push(
      pad(`  ${t.fg("muted", "compact")}  ${t.fg("dim", "terse summaries and minimal previews")}`),
    );
    lines.push(
      pad(`  ${t.fg("muted", "balanced")} ${t.fg("dim", "concise defaults with useful previews")}`),
    );
    lines.push(
      pad(
        `  ${t.fg("muted", "verbose")}  ${t.fg("dim", "richer previews and fuller research detail")}`,
      ),
    );
    lines.push(pad(""));
    const dirty = this.profile !== this.savedProfile;
    lines.push(pad(`  ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`));
    lines.push(pad(`  ${t.fg("muted", "Current source:")} ${t.fg("dim", this.savedSource)}`));
    if (dirty) lines.push(pad(`  ${t.fg("warning", "Unsaved change — press Enter to save")}`));
    lines.push(pad(""));
    lines.push(pad(` ${t.fg("dim", "←/→ change · Enter save · Esc back")}`));

    return lines;
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private cycleProfile(direction: -1 | 1): void {
    const currentIndex = SF_PI_DISPLAY_PROFILES.indexOf(this.profile);
    const nextIndex =
      (currentIndex + direction + SF_PI_DISPLAY_PROFILES.length) % SF_PI_DISPLAY_PROFILES.length;
    // Modulo arithmetic keeps nextIndex in range of SF_PI_DISPLAY_PROFILES,
    // but TS needs help to prove it. Fall back to the current profile if
    // indexing ever returns undefined (should be unreachable).
    this.profile = SF_PI_DISPLAY_PROFILES[nextIndex] ?? this.profile;
  }

  private save(): void {
    const saved = writeScopedSfPiDisplaySettings(this.cwd, this.scope, { profile: this.profile });
    this.savedProfile = saved.settings.profile;
    this.savedSource = saved.path;
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfPiManagerConfigPanel(theme, cwd, scope, done);
};
