/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Config panel for sf-guardrail inside the SF Pi Manager surface.
 *
 * Routine Guardrail Preferences are backed by Pi's native settings.json under
 * `sfPi.guardrail`. Advanced custom rule overrides stay in the expert override
 * file and are summarized here instead of edited inline.
 */
import { type Focusable, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { globalSettingsPath } from "../../../lib/common/sf-pi-settings.ts";
import { loadConfig, userConfigPath } from "./config.ts";
import {
  applyGuardrailPreset,
  buildGuardrailPreferenceDescriptors,
  preferenceValue,
  updateUserPreference,
  type GuardrailPreferenceDescriptor,
} from "./preferences.ts";
import type { GuardrailConfig } from "./types.ts";

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

class SfGuardrailConfigPanel implements Focusable {
  focused = false;
  private selected = 0;
  private lastSavedMessage = "";
  private config: GuardrailConfig;
  private source: string;

  constructor(
    private readonly theme: Theme,
    private readonly scope: "global" | "project",
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const loaded = loadConfig();
    this.config = loaded.config;
    this.source = loaded.source;
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }

    if (this.scope === "project") return;

    if (matchesKey(data, "up") && this.selected > 0) {
      this.selected -= 1;
      return;
    }
    if (matchesKey(data, "down") && this.selected < this.descriptors().length - 1) {
      this.selected += 1;
      return;
    }
    if (matchesKey(data, "left")) {
      this.cycleSelected(-1);
      return;
    }
    if (matchesKey(data, "right") || matchesKey(data, "space")) {
      this.cycleSelected(1);
      return;
    }
    if (data === "p") {
      applyGuardrailPreset("powerTool", this.config);
      this.reload("Power Tool preset saved to Pi settings.");
      return;
    }
    if (data === "s") {
      applyGuardrailPreset("strict", this.config);
      this.reload("Strict preset saved to Pi settings.");
    }
  }

  renderContent(width: number): string[] {
    const lines: string[] = [];
    const t = this.theme;
    const pad = (content = "") => padAnsi(truncateToWidth(content, width, ""), width);

    lines.push(pad(` ${t.fg("muted", "SF Guardrail — settings")}`));
    lines.push(pad(""));

    if (this.scope === "project") {
      lines.push(pad(` ${t.fg("warning", "Project-scoped guardrail settings are deferred.")}`));
      lines.push(pad(""));
      lines.push(
        pad(
          ` ${t.fg("dim", "Guardrail preferences are global-only so a repository cannot silently weaken local safety rules.")}`,
        ),
      );
      lines.push(pad(""));
      lines.push(pad(` ${t.fg("muted", "Global settings:")} ${t.fg("dim", globalSettingsPath())}`));
      lines.push(pad(` ${t.fg("dim", "Esc to go back.")}`));
      return lines;
    }

    lines.push(
      pad(` ${t.fg("muted", "Routine preferences:")} ${t.fg("dim", globalSettingsPath())}`),
    );
    lines.push(pad(` ${t.fg("muted", "Advanced overrides:")}  ${t.fg("dim", userConfigPath())}`));
    lines.push(pad(` ${t.fg("muted", "Effective source:")}     ${t.fg("text", this.source)}`));
    lines.push(pad(""));
    lines.push(
      pad(
        ` ${t.fg("dim", "←/→ changes the selected value immediately. p = Power Tool, s = Strict.")}`,
      ),
    );
    lines.push(pad(""));

    const descriptors = this.descriptors();
    let currentSection = "";
    for (let i = 0; i < descriptors.length; i++) {
      const descriptor = descriptors[i];
      if (!descriptor) continue;
      if (descriptor.section !== currentSection) {
        currentSection = descriptor.section;
        lines.push(pad(` ${t.fg("accent", sectionTitle(currentSection))}`));
      }
      lines.push(pad(this.renderDescriptorLine(descriptor, i === this.selected, width)));
      if (i === this.selected) {
        for (const detail of this.detailLines(descriptor, width)) lines.push(pad(detail));
      }
    }

    lines.push(pad(""));
    if (this.lastSavedMessage) lines.push(pad(` ${t.fg("success", this.lastSavedMessage)}`));
    lines.push(pad(` ${t.fg("dim", "Esc back · changes are saved as you edit")}`));
    return lines;
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private descriptors(): GuardrailPreferenceDescriptor[] {
    return buildGuardrailPreferenceDescriptors(this.config).filter(
      (descriptor) =>
        descriptor.key !== "enabled" &&
        descriptor.section !== "posture" &&
        descriptor.section !== "aliases" &&
        descriptor.section !== "advanced",
    );
  }

  private renderDescriptorLine(
    descriptor: GuardrailPreferenceDescriptor,
    selected: boolean,
    width: number,
  ): string {
    const t = this.theme;
    const current = displayValue(preferenceValue(this.config, descriptor.key));
    const prefix = selected ? t.fg("accent", " → ") : "   ";
    const valueWidth = 12;
    const labelWidth = Math.max(18, width - valueWidth - 7);
    const label = truncateToWidth(descriptor.label, labelWidth, "…");
    const padding = " ".repeat(Math.max(1, labelWidth - visibleWidth(label) + 1));
    const value = selected ? t.fg("accent", current) : t.fg("muted", current);
    return `${prefix}${label}${padding}${value}`;
  }

  private detailLines(descriptor: GuardrailPreferenceDescriptor, width: number): string[] {
    const t = this.theme;
    const detailWidth = Math.max(20, width - 6);
    const lines = [
      descriptor.description,
      descriptor.example ? `Example: ${descriptor.example}` : undefined,
      descriptor.why ? `Why: ${descriptor.why}` : undefined,
      `Values: ${descriptor.values.map(displayValue).join(" · ")}`,
    ].filter((line): line is string => !!line);
    return lines.map((line) => `     ${t.fg("dim", truncateToWidth(line, detailWidth, "…"))}`);
  }

  private cycleSelected(direction: -1 | 1): void {
    const descriptor = this.descriptors()[this.selected];
    if (!descriptor) return;
    const current = preferenceValue(this.config, descriptor.key);
    const currentIndex = Math.max(0, descriptor.values.indexOf(current));
    const nextIndex =
      (currentIndex + direction + descriptor.values.length) % descriptor.values.length;
    const nextValue = descriptor.values[nextIndex];
    if (!nextValue) return;
    updateUserPreference(descriptor.key, nextValue, this.config);
    this.reload(`${descriptor.label}: ${displayValue(nextValue)} saved.`);
  }

  private reload(message: string): void {
    const loaded = loadConfig();
    this.config = loaded.config;
    this.source = loaded.source;
    this.lastSavedMessage = message;
  }
}

function sectionTitle(section: string): string {
  switch (section) {
    case "core":
      return "Core controls";
    case "files":
      return "File protection";
    case "commands":
      return "Dangerous commands";
    case "orgs":
      return "Salesforce org operations";
    default:
      return section;
  }
}

function displayValue(value: string): string {
  switch (value) {
    case "confirm":
      return "Ask me";
    case "hard block":
    case "block":
      return "Block";
    case "off":
      return "Off";
    case "on":
      return "On";
    default:
      return value.endsWith("000") ? `${Number(value) / 1000}s` : value;
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, _cwd, scope, done) => {
  return new SfGuardrailConfigPanel(theme, scope, done);
};
