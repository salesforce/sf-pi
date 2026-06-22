/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Browser defaults. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  EVIDENCE_IMAGE_MODES,
  readEffectiveSfBrowserSettings,
  writeScopedSfBrowserSettings,
  type SfBrowserSettings,
  type SfBrowserSettingsScope,
} from "./settings.ts";

class SfBrowserConfigPanel implements Focusable {
  focused = false;
  private cursor = 0;
  private draft: SfBrowserSettings;
  private saved: SfBrowserSettings;
  private source: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: SfBrowserSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveSfBrowserSettings(cwd);
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
      this.cursor = (this.cursor + (matchesKey(data, "up") ? 2 : 1) + 3) % 3;
      this.message = "";
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.toggleCurrent(matchesKey(data, "left") ? -1 : 1);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") this.save();
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = JSON.stringify(this.draft) !== JSON.stringify(this.saved);
    const row = (index: number, label: string, value: string, help: string) => [
      ` ${this.cursor === index ? t.fg("accent", "→") : " "} ${t.fg(this.cursor === index ? "accent" : "text", label.padEnd(24))} ${t.fg("muted", value)}`,
      `    ${t.fg("dim", help)}`,
    ];
    return [
      ` ${t.fg("accent", t.bold("SF Browser Settings"))}`,
      ` ${t.fg("dim", "Defaults for Browser Evidence captures when a tool or command omits an option.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.source)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ...row(
        0,
        "Evidence image mode",
        this.draft.evidenceImageMode,
        "artifact for batches, thumbnail for visual inspection, full for small high-fidelity captures.",
      ),
      ...row(
        1,
        "Dismiss overlays",
        String(this.draft.dismissOverlays),
        "Dismiss known ambient Salesforce overlays before evidence capture.",
      ),
      ...row(
        2,
        "Setup audit trail",
        String(this.draft.includeSetupAuditTrail),
        "Include recent Setup Audit Trail context by default for evidence captures.",
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

  private toggleCurrent(direction: -1 | 1): void {
    if (this.cursor === 0) {
      const index = EVIDENCE_IMAGE_MODES.indexOf(this.draft.evidenceImageMode);
      this.draft.evidenceImageMode =
        EVIDENCE_IMAGE_MODES[
          (index + direction + EVIDENCE_IMAGE_MODES.length) % EVIDENCE_IMAGE_MODES.length
        ] ?? this.draft.evidenceImageMode;
    } else if (this.cursor === 1) this.draft.dismissOverlays = !this.draft.dismissOverlays;
    else this.draft.includeSetupAuditTrail = !this.draft.includeSetupAuditTrail;
    this.message = "";
  }

  private save(): void {
    if (JSON.stringify(this.draft) === JSON.stringify(this.saved)) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedSfBrowserSettings(this.cwd, this.scope, this.draft);
    this.saved = {
      evidenceImageMode: saved.evidenceImageMode,
      dismissOverlays: saved.dismissOverlays,
      includeSetupAuditTrail: saved.includeSetupAuditTrail,
    };
    this.source = `${saved.source} (${saved.path})`;
    this.message = "Saved SF Browser settings.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) =>
  new SfBrowserConfigPanel(theme, cwd, scope, done);
