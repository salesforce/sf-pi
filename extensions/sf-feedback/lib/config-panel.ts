/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Feedback preferences. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  FEEDBACK_DEFAULT_KINDS,
  readEffectiveFeedbackSettings,
  writeScopedFeedbackSettings,
  type FeedbackSettingsScope,
} from "./settings.ts";
import type { IssueKind } from "./types.ts";

class FeedbackConfigPanel implements Focusable {
  focused = false;
  private kind: IssueKind;
  private savedKind: IssueKind;
  private source: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: FeedbackSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveFeedbackSettings(cwd);
    this.kind = effective.defaultIssueKind;
    this.savedKind = this.kind;
    this.source =
      effective.source === "default" ? "default" : `${effective.source} (${effective.path})`;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.cycle(matchesKey(data, "left") ? -1 : 1);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") this.save();
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.kind !== this.savedKind;
    return [
      ` ${t.fg("accent", t.bold("SF Feedback Settings"))}`,
      ` ${t.fg("dim", "Defaults for direct/headless feedback drafts. Interactive submissions still preview and confirm.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.source)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ` ${t.fg("muted", "Default issue kind")} ${t.fg(dirty ? "accent" : "text", this.kind)}`,
      `   ${t.fg("dim", "Used when no explicit bug/feature/setup/feedback subcommand is provided.")}`,
      "",
      ...(this.message ? [` ${t.fg("success", this.message)}`] : []),
      ` ${t.fg("dim", "←/→ change · S/Enter save · Esc back")}`,
    ];
  }
  render(): string[] {
    return this.renderContent();
  }
  invalidate(): void {}

  private cycle(direction: -1 | 1): void {
    const index = Math.max(0, FEEDBACK_DEFAULT_KINDS.indexOf(this.kind));
    this.kind =
      FEEDBACK_DEFAULT_KINDS[
        (index + direction + FEEDBACK_DEFAULT_KINDS.length) % FEEDBACK_DEFAULT_KINDS.length
      ] ?? this.kind;
    this.message = "";
  }

  private save(): void {
    if (this.kind === this.savedKind) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedFeedbackSettings(this.cwd, this.scope, {
      defaultIssueKind: this.kind,
    });
    this.savedKind = saved.defaultIssueKind;
    this.source = `${saved.source} (${saved.path})`;
    this.message = "Saved Feedback settings.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) =>
  new FeedbackConfigPanel(theme, cwd, scope, done);
