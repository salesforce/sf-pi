/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Settings/status panel for sf-data360.
 *
 * Keeps the standardized Manager drill-down experience while exposing one
 * low-risk preference: default output mode for data360_* tool calls when the
 * caller omits output_mode.
 */
import { type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import { HEADLESS_WRITE_ENV } from "./api-tool.ts";
import { DATA360_V2_TOOL_DEFS } from "./v2/tools.ts";
import {
  DATA360_OUTPUT_MODES,
  describeData360SettingsSource,
  readEffectiveData360Settings,
  readScopedData360Settings,
  writeScopedData360Settings,
  type Data360OutputModeSetting,
  type Data360SettingsScope,
} from "./settings.ts";

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

class SfData360ConfigPanel implements Focusable {
  focused = false;

  private outputMode: Data360OutputModeSetting;
  private savedOutputMode: Data360OutputModeSetting;
  private savedSource: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: Data360SettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const scoped = readScopedData360Settings(cwd, scope);
    const effective = readEffectiveData360Settings(cwd);
    this.outputMode = scoped.exists
      ? scoped.settings.defaultOutputMode
      : effective.defaultOutputMode;
    this.savedOutputMode = this.outputMode;
    this.savedSource = scoped.exists ? scoped.path : describeData360SettingsSource(effective);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "up")) {
      this.cycleOutputMode(-1);
      return;
    }
    if (matchesKey(data, "right") || matchesKey(data, "down") || matchesKey(data, "space")) {
      this.cycleOutputMode(1);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") {
      this.save();
    }
  }

  renderContent(width: number): string[] {
    const lines: string[] = [];
    const t = this.theme;
    const pad = (content: string) => padAnsi(content, width);
    const enabled = isSfPiExtensionEnabled(this.cwd, "sf-data360");

    lines.push(pad(` ${t.fg("muted", "SF Data 360 — settings & status")}`));
    lines.push(pad(""));

    const dot = enabled ? t.fg("success", "●") : t.fg("error", "○");
    lines.push(
      pad(
        ` ${dot} ${t.fg("text", enabled ? "Enabled by default" : "Disabled by user settings")}   ${t.fg(
          "dim",
          `(scope: ${this.scope})`,
        )}`,
      ),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Preferences:")}`));
    lines.push(
      pad(
        `   ${t.fg("text", "Default output mode")} ${t.fg("muted", this.outputMode)}${this.outputMode !== this.savedOutputMode ? t.fg("warning", "  unsaved") : ""}`,
      ),
    );
    lines.push(pad(`   ${t.fg("muted", "Current source:")} ${t.fg("dim", this.savedSource)}`));
    if (this.message) lines.push(pad(`   ${t.fg("success", this.message)}`));
    lines.push(pad(`   ${t.fg("dim", "←/→ change · S/Enter save")}`));
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Runtime:")}`));
    lines.push(
      pad(`   ${t.fg("text", "REST backend")} ${t.fg("dim", "@salesforce/core Connection")}`),
    );
    lines.push(
      pad(`   ${t.fg("text", "Auth source")}   ${t.fg("dim", "Salesforce CLI org auth")}`),
    );
    lines.push(pad(`   ${t.fg("text", "MCP/Java")}      ${t.fg("dim", "not used")}`));
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "When enabled:")}`));
    for (const tool of DATA360_V2_TOOL_DEFS.slice(0, 6)) {
      lines.push(
        pad(`   ${toolDot(t, enabled)} ${tool.name.padEnd(22)} ${t.fg("dim", tool.label)}`),
      );
    }
    lines.push(
      pad(`   ${t.fg("dim", `… ${DATA360_V2_TOOL_DEFS.length - 6} more data360_* tools`)}`),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Safety:")}`));
    lines.push(pad(`   ${t.fg("dim", "•")} dry_run is available before mutating calls`));
    lines.push(
      pad(`   ${t.fg("dim", "•")} DELETE always confirms; run/publish/deploy action paths confirm`),
    );
    lines.push(pad(`   ${t.fg("dim", "•")} Headless writes require ${HEADLESS_WRITE_ENV}=1`));
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "References:")}`));
    lines.push(pad(`   ${t.fg("dim", "extensions/sf-data360/references/")}`));
    lines.push(pad(""));
    lines.push(
      pad(
        ` ${t.fg(
          "dim",
          enabled
            ? "Use /sf-data360 for status; read references/ for deeper guidance. Esc to go back."
            : "Re-enable with /sf-pi enable sf-data360, then /reload. Esc to go back.",
        )}`,
      ),
    );

    return lines;
  }

  private cycleOutputMode(direction: -1 | 1): void {
    const currentIndex = DATA360_OUTPUT_MODES.indexOf(this.outputMode);
    const nextIndex =
      (currentIndex + direction + DATA360_OUTPUT_MODES.length) % DATA360_OUTPUT_MODES.length;
    this.outputMode = DATA360_OUTPUT_MODES[nextIndex] ?? this.outputMode;
    this.message = "";
  }

  private save(): void {
    if (this.outputMode === this.savedOutputMode) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedData360Settings(this.cwd, this.scope, {
      defaultOutputMode: this.outputMode,
    });
    this.savedOutputMode = saved.settings.defaultOutputMode;
    this.savedSource = saved.path;
    this.message = "Saved Data 360 settings.";
  }
}

function toolDot(t: Theme, enabled: boolean): string {
  return enabled ? t.fg("success", "●") : t.fg("dim", "○");
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfData360ConfigPanel(theme, cwd, scope, done);
};
