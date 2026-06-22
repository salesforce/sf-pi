/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Agent Script defaults. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  EVAL_CONCURRENCY_VALUES,
  EVAL_TRACE_MODES,
  PREVIEW_MOCK_MODES,
  readEffectiveAgentScriptSettings,
  writeScopedAgentScriptSettings,
  type AgentScriptSettings,
  type AgentScriptSettingsScope,
} from "./settings.ts";

class AgentScriptConfigPanel implements Focusable {
  focused = false;
  private cursor = 0;
  private draft: AgentScriptSettings;
  private saved: AgentScriptSettings;
  private source: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: AgentScriptSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveAgentScriptSettings(cwd);
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
    const row = (index: number, label: string, value: string, detail: string) => [
      ` ${this.cursor === index ? t.fg("accent", "→") : " "} ${t.fg(this.cursor === index ? "accent" : "text", label.padEnd(24))} ${t.fg("muted", value)}`,
      `    ${t.fg("dim", detail)}`,
    ];
    return [
      ` ${t.fg("accent", t.bold("SF Agent Script Settings"))}`,
      ` ${t.fg("dim", "Defaults for Agent Script preview and eval tool calls when omitted.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.source)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ...row(
        0,
        "Preview mock mode",
        this.draft.previewMockMode,
        "Default for agentscript_preview start when mock_mode is omitted.",
      ),
      ...row(
        1,
        "Eval trace mode",
        this.draft.evalTracesMode,
        "Default traces_mode for agentscript_eval run when omitted.",
      ),
      ...row(
        2,
        "Eval concurrency",
        String(this.draft.evalConcurrency),
        "Default concurrency for agentscript_eval run when omitted.",
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
    if (this.cursor === 0)
      this.draft.previewMockMode = cycle(PREVIEW_MOCK_MODES, this.draft.previewMockMode, direction);
    else if (this.cursor === 1)
      this.draft.evalTracesMode = cycle(EVAL_TRACE_MODES, this.draft.evalTracesMode, direction);
    else
      this.draft.evalConcurrency = cycle(
        EVAL_CONCURRENCY_VALUES,
        this.draft.evalConcurrency,
        direction,
      );
    this.message = "";
  }

  private save(): void {
    if (JSON.stringify(this.draft) === JSON.stringify(this.saved)) {
      this.message = "No changes to save.";
      return;
    }
    const saved = writeScopedAgentScriptSettings(this.cwd, this.scope, this.draft);
    this.saved = {
      previewMockMode: saved.previewMockMode,
      evalTracesMode: saved.evalTracesMode,
      evalConcurrency: saved.evalConcurrency,
    };
    this.source = `${saved.source} (${saved.path})`;
    this.message = "Saved Agent Script settings.";
  }
}

function cycle<T>(values: readonly T[], current: T, direction: -1 | 1): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + direction + values.length) % values.length] ?? current;
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) =>
  new AgentScriptConfigPanel(theme, cwd, scope, done);
