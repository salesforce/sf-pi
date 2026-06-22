/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Code Analyzer automation preferences. */
import { type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  describeSetting,
  readEffectiveCodeAnalyzerSettings,
  writeCodeAnalyzerSetting,
  type CodeAnalyzerSettingKey,
} from "./settings.ts";

interface SettingRow {
  key: CodeAnalyzerSettingKey;
  label: string;
  description: string;
}

const SETTING_ROWS: readonly SettingRow[] = [
  {
    key: "autoScan",
    label: "Deferred auto-scan",
    description: "Run readiness-gated local Code Analyzer scans after agent edits.",
  },
  {
    key: "apexGuruAuto",
    label: "ApexGuru auto insights",
    description: "Suggest ApexGuru insights automatically when cached org readiness allows it.",
  },
];

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

class CodeAnalyzerConfigPanel implements Focusable {
  focused = false;

  private cursor = 0;
  private autoScan: boolean;
  private apexGuruAuto: boolean;
  private savedAutoScan: boolean;
  private savedApexGuruAuto: boolean;
  private savedSource: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: "global" | "project",
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveCodeAnalyzerSettings(cwd);
    this.autoScan = effective.autoScan;
    this.apexGuruAuto = effective.apexGuruAuto;
    this.savedAutoScan = this.autoScan;
    this.savedApexGuruAuto = this.apexGuruAuto;
    this.savedSource = `auto-scan ${describeSetting(effective, "autoScan")} · ApexGuru ${describeSetting(effective, "apexGuruAuto")}`;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.move(1);
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.toggleCurrent();
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") {
      this.save();
    }
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    const pad = (content = "") => padAnsi(content, width);
    const dirty = this.isDirty();
    const lines: string[] = [
      ` ${t.fg("accent", t.bold("SF Code Analyzer Settings"))}`,
      ` ${t.fg("dim", "Tune local automation. Explicit code_analyzer tool runs are unaffected.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.savedSource)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
    ];

    for (let i = 0; i < SETTING_ROWS.length; i++) {
      const row = SETTING_ROWS[i];
      if (!row) continue;
      const selected = i === this.cursor;
      const value = this.valueFor(row.key) ? "on" : "off";
      const cursor = selected ? t.fg("accent", "→") : " ";
      const label = selected ? t.fg("accent", row.label) : t.fg("text", row.label);
      lines.push(` ${cursor} ${label.padEnd(26)} ${t.fg("muted", value)}`);
      if (selected) lines.push(`    ${t.fg("dim", row.description)}`);
    }

    lines.push("");
    if (this.message) lines.push(` ${t.fg("success", this.message)}`);
    lines.push(` ${t.fg("dim", "↑/↓ move · ←/→ toggle · S/Enter save · Esc back")}`);
    return lines.map(pad);
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private move(delta: -1 | 1): void {
    this.cursor = (this.cursor + delta + SETTING_ROWS.length) % SETTING_ROWS.length;
    this.message = "";
  }

  private toggleCurrent(): void {
    const row = SETTING_ROWS[this.cursor];
    if (!row) return;
    if (row.key === "autoScan") this.autoScan = !this.autoScan;
    else this.apexGuruAuto = !this.apexGuruAuto;
    this.message = "";
  }

  private save(): void {
    if (!this.isDirty()) {
      this.message = "No changes to save.";
      return;
    }
    let effective = readEffectiveCodeAnalyzerSettings(this.cwd);
    if (this.autoScan !== this.savedAutoScan) {
      effective = writeCodeAnalyzerSetting(this.cwd, this.scope, "autoScan", this.autoScan);
    }
    if (this.apexGuruAuto !== this.savedApexGuruAuto) {
      effective = writeCodeAnalyzerSetting(this.cwd, this.scope, "apexGuruAuto", this.apexGuruAuto);
    }
    this.savedAutoScan = this.autoScan;
    this.savedApexGuruAuto = this.apexGuruAuto;
    this.savedSource = `auto-scan ${describeSetting(effective, "autoScan")} · ApexGuru ${describeSetting(effective, "apexGuruAuto")}`;
    this.message = "Saved Code Analyzer settings.";
  }

  private valueFor(key: CodeAnalyzerSettingKey): boolean {
    return key === "autoScan" ? this.autoScan : this.apexGuruAuto;
  }

  private isDirty(): boolean {
    return this.autoScan !== this.savedAutoScan || this.apexGuruAuto !== this.savedApexGuruAuto;
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new CodeAnalyzerConfigPanel(theme, cwd, scope, done);
};
