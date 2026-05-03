/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Config panel for sf-guardrail — read-only status shown in the sf-pi
 * Extension Manager overlay. Modeled on sf-slack/config-panel.ts.
 *
 * Operators who want to *edit* config use `/sf-guardrail settings` (settings
 * overlay) or hand-edit the override file. This panel just summarizes what
 * is loaded so the manager overlay can answer "is this active? with which
 * rules?".
 */
import { type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { loadConfig, userConfigPath } from "./config.ts";

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

class SfGuardrailConfigPanel implements Focusable {
  focused = false;

  constructor(
    private readonly theme: Theme,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
    }
  }

  renderContent(width: number): string[] {
    const lines: string[] = [];
    const t = this.theme;
    const pad = (content: string) => padAnsi(content, width);

    const { config, source } = loadConfig();
    const enabled = config.enabled;

    lines.push(pad(` ${t.fg("muted", "SF Guardrail — active rules")}`));
    lines.push(pad(""));

    const dot = enabled ? t.fg("success", "●") : t.fg("error", "●");
    const status = enabled ? "Enabled" : "Disabled";
    lines.push(pad(` ${dot} ${t.fg("text", status)}   ${t.fg("dim", `(source: ${source})`)}`));
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Features:")}`));
    lines.push(
      pad(
        `   ${featureDot(t, config.features.policies)} policies         ${t.fg("dim", `${activeCount(config.policies.rules.map((r) => r.enabled))}/${config.policies.rules.length} rules`)}`,
      ),
    );
    lines.push(
      pad(
        `   ${featureDot(t, config.features.commandGate)} commandGate      ${t.fg("dim", `${config.commandGate.patterns.length} patterns, ${config.commandGate.autoDenyPatterns.length} auto-deny`)}`,
      ),
    );
    lines.push(
      pad(
        `   ${featureDot(t, config.features.orgAwareGate)} orgAwareGate     ${t.fg("dim", `${activeCount(config.orgAwareGate.rules.map((r) => r.enabled))}/${config.orgAwareGate.rules.length} rules`)}`,
      ),
    );
    lines.push(
      pad(
        `   ${featureDot(t, config.features.promptInjection)} promptInjection  ${t.fg("dim", "inject once per session")}`,
      ),
    );
    lines.push(pad(""));

    if (config.productionAliases.length > 0) {
      lines.push(
        pad(
          ` ${t.fg("muted", "Production aliases:")} ${t.fg("text", config.productionAliases.join(", "))}`,
        ),
      );
    } else {
      lines.push(
        pad(
          ` ${t.fg("muted", "Production aliases:")} ${t.fg("dim", "(none — relies on org-type detection)")}`,
        ),
      );
    }

    lines.push(
      pad(` ${t.fg("muted", "Confirm timeout:")} ${t.fg("text", `${config.confirmTimeoutMs} ms`)}`),
    );
    lines.push(
      pad(` ${t.fg("muted", "Headless env:")}    ${t.fg("text", config.headlessEscapeHatchEnv)}`),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Override file:")} ${t.fg("dim", userConfigPath())}`));
    lines.push(pad(""));
    lines.push(pad(` ${t.fg("dim", "Use /sf-guardrail to inspect. Esc to go back.")}`));

    return lines;
  }
}

function featureDot(t: Theme, on: boolean): string {
  return on ? t.fg("success", "●") : t.fg("dim", "○");
}

function activeCount(flags: (boolean | undefined)[]): number {
  return flags.filter((v) => v !== false).length;
}

export const createConfigPanel: ConfigPanelFactory = (theme, _cwd, _scope, done) => {
  return new SfGuardrailConfigPanel(theme, done);
};
