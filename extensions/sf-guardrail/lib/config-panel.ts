/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Config panel for sf-guardrail inside the SF Pi Manager surface.
 *
 * Routine Guardrail Preferences are backed by Pi's native settings.json under
 * `sfPi.guardrail`. Advanced custom rule overrides stay in the expert override
 * file and are rendered as rule definition sources, not edited as raw JSON.
 */
import {
  Input,
  type Focusable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { globalSettingsPath } from "../../../lib/common/sf-pi-settings.ts";
import { loadConfig, userConfigPath } from "./config.ts";
import {
  GUARDRAIL_PREFERENCE_DESCRIPTORS,
  buildGuardrailPreferenceDescriptors,
  preferenceValue,
  productionAliasesText,
  updateProductionAliasesFromText,
  updateUserPreference,
  type GuardrailPreferenceDescriptor,
} from "./preferences.ts";
import type { CommandPattern, GuardrailConfig, OrgAwareRule, PolicyRule } from "./types.ts";
import {
  SECTION_ITEMS,
  resolveRuleBehaviorSource,
  resolveRuleDefinitionSource,
  ruleIdFromPreferenceKey,
  rulesTitle,
  sourceLabel,
  type RuleBehaviorSource,
  type RuleDefinitionSource,
  type RulePanelSection,
} from "./config-panel-model.ts";

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

type SettingsPage =
  | { kind: "home" }
  | { kind: "rules"; section: RulePanelSection; filter: string; filtering: boolean }
  | { kind: "rule-detail"; section: RulePanelSection; ruleId: string }
  | { kind: "aliases"; editing: boolean; draft: string }
  | { kind: "advanced" };

interface RuleRow {
  id: string;
  descriptor: GuardrailPreferenceDescriptor;
  definition: PolicyRule | CommandPattern | OrgAwareRule;
  definitionSource: RuleDefinitionSource;
  behaviorSource: RuleBehaviorSource;
}

class SfGuardrailConfigPanel implements Focusable {
  private _focused = false;
  private page: SettingsPage = { kind: "home" };
  private selectedByPage: Record<string, number> = {};
  private lastSavedMessage = "";
  private config: GuardrailConfig;
  private source: string;
  private aliasInput: Input | undefined;

  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    if (this.aliasInput) this.aliasInput.focused = value;
  }

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
    if (this.scope === "project") {
      if (matchesKey(data, "escape") || data === "q") this.done(undefined);
      return;
    }

    if (this.page.kind === "aliases" && this.page.editing) {
      this.handleAliasEditInput(data);
      return;
    }

    if (this.page.kind === "rules" && this.page.filtering) {
      this.handleRuleFilterInput(data);
      return;
    }

    if (matchesKey(data, "escape") || data === "q") {
      this.goBack();
      return;
    }

    switch (this.page.kind) {
      case "home":
        this.handleHomeInput(data);
        return;
      case "rules":
        this.handleRulesInput(data);
        return;
      case "rule-detail":
        this.handleRuleDetailInput(data);
        return;
      case "aliases":
        this.handleAliasesInput(data);
        return;
      case "advanced":
        return;
    }
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    const lines: string[] = [];
    const pad = (content = "") => padAnsi(truncateToWidth(content, width, ""), width);

    if (this.scope === "project") {
      return this.renderProjectScope(width).map(pad);
    }

    lines.push(...this.renderBreadcrumb(width));
    lines.push("");

    switch (this.page.kind) {
      case "home":
        lines.push(...this.renderHome(width));
        break;
      case "rules":
        lines.push(...this.renderRulesPage(width, this.page.section));
        break;
      case "rule-detail":
        lines.push(...this.renderRuleDetail(width, this.page.section, this.page.ruleId));
        break;
      case "aliases":
        lines.push(...this.renderAliases(width));
        break;
      case "advanced":
        lines.push(...this.renderAdvanced(width));
        break;
    }

    lines.push("");
    if (this.lastSavedMessage) lines.push(` ${t.fg("success", this.lastSavedMessage)}`);
    lines.push(` ${t.fg("dim", this.footerText())}`);
    return lines.map(pad);
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private renderProjectScope(width: number): string[] {
    const t = this.theme;
    return [
      ` ${t.fg("accent", themeBold(t, "SF Pi › SF Guardrail › Settings"))}`,
      "",
      ` ${t.fg("warning", "Project-scoped guardrail settings are deferred.")}`,
      "",
      ...wrapLines(
        "Guardrail Preferences are global-only so a repository cannot silently weaken local safety rules.",
        width - 3,
      ).map((line) => ` ${t.fg("dim", line)}`),
      "",
      ` ${t.fg("muted", "Global settings:")} ${t.fg("dim", globalSettingsPath())}`,
      "",
      ` ${t.fg("dim", "Esc back")}`,
    ];
  }

  private renderBreadcrumb(width: number): string[] {
    const t = this.theme;
    const suffix = this.pageTitle();
    const text = suffix
      ? `SF Pi › SF Guardrail › Settings › ${suffix}`
      : "SF Pi › SF Guardrail › Settings";
    return [` ${t.fg("accent", themeBold(t, truncateToWidth(text, width - 2, "…")))}`];
  }

  private renderHome(width: number): string[] {
    const t = this.theme;
    const lines = [
      ` ${t.fg("muted", "Routine preferences:")} ${t.fg("dim", globalSettingsPath())}`,
      ` ${t.fg("muted", "Advanced overrides:")}  ${t.fg("dim", userConfigPath())}`,
      ` ${t.fg("muted", "Effective source:")}     ${t.fg("text", this.source)}`,
      "",
      ` ${t.fg("muted", "Approval timeout:")}    ${t.fg("text", displayValue(preferenceValue(this.config, "confirmTimeoutMs")))}`,
      ` ${t.fg("muted", "Headless mode:")}       ${t.fg("text", process.env[this.config.headlessEscapeHatchEnv] ? "opt-in pass" : "fail-closed")}`,
      "",
      ` ${t.fg("accent", themeBold(t, "Sections"))}`,
    ];

    const selected = this.selected("home");
    for (let i = 0; i < SECTION_ITEMS.length; i++) {
      const item = SECTION_ITEMS[i];
      if (!item) continue;
      const isSelected = i === selected;
      const cursor = isSelected ? t.fg("accent", "→") : " ";
      const label = isSelected ? t.fg("accent", item.label) : t.fg("text", item.label);
      lines.push(` ${cursor} ${label}`);
      lines.push(
        `    ${t.fg("dim", truncateToWidth(item.description, Math.max(20, width - 6), "…"))}`,
      );
    }
    return lines;
  }

  private renderRulesPage(width: number, section: RulePanelSection): string[] {
    const t = this.theme;
    const rows = this.filteredRuleRows(section);
    const selected = Math.min(this.selected(section), Math.max(0, rows.length - 1));
    const lines: string[] = [];
    if (this.page.kind === "rules" && this.page.filter) {
      lines.push(
        ` ${t.fg("muted", "Filter:")} ${t.fg("accent", this.page.filter)} ${t.fg("dim", `(${rows.length})`)}`,
      );
      lines.push("");
    }
    lines.push(
      ` ${t.fg("accent", themeBold(t, "Rule id"))}${" ".repeat(31)}${t.fg("accent", themeBold(t, "Behavior"))}${" ".repeat(4)}${t.fg("accent", themeBold(t, "Source"))}`,
    );
    if (rows.length === 0) {
      lines.push(` ${t.fg("warning", "No matching rules.")}`);
      return lines;
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      lines.push(this.renderRuleLine(row, i === selected, width));
      if (i === selected) lines.push(...this.ruleSummaryLines(row, width));
    }
    return lines;
  }

  private renderRuleDetail(width: number, section: RulePanelSection, ruleId: string): string[] {
    const row = this.ruleRows(section).find((candidate) => candidate.id === ruleId);
    if (!row) return [` ${this.theme.fg("warning", `Rule not found: ${ruleId}`)}`];
    const t = this.theme;
    return [
      ` ${t.fg("accent", themeBold(t, "Rule"))}`,
      `   id:        ${row.id}`,
      `   label:     ${row.descriptor.label}`,
      `   behavior:  ${displayValue(preferenceValue(this.config, row.descriptor.key))}`,
      `   definition:${" ".repeat(1)}${row.definitionSource}`,
      `   behavior source: ${row.behaviorSource}`,
      "",
      ` ${t.fg("accent", themeBold(t, "Description"))}`,
      ...wrapLines(row.descriptor.description, width - 5).map((line) => `   ${t.fg("dim", line)}`),
      row.descriptor.example ? `   ${t.fg("dim", `Example: ${row.descriptor.example}`)}` : "",
      row.descriptor.why ? `   ${t.fg("dim", `Why: ${row.descriptor.why}`)}` : "",
      "",
      ` ${t.fg("accent", themeBold(t, "JSON preview"))}`,
      ...this.jsonPreview(row.definition, width).map((line) => `   ${t.fg("dim", line)}`),
    ].filter(Boolean);
  }

  private renderAliases(width: number): string[] {
    const t = this.theme;
    const current = productionAliasesText(this.config);
    if (this.page.kind === "aliases" && this.page.editing) {
      const inputRows = this.aliasInput?.render(Math.max(20, width - 4)) ?? [this.page.draft];
      return [
        ` ${t.fg("accent", themeBold(t, "Edit aliases"))}`,
        `   ${t.fg("dim", "Comma-separated aliases to treat as production-level risk targets.")}`,
        "",
        ...inputRows.map((line) => `   ${line}`),
      ];
    }
    return [
      ` ${t.fg("accent", themeBold(t, "Protected org aliases"))}`,
      ...wrapLines(
        "Aliases listed here receive production-level guardrail prompts. Useful for prod, full-copy, staging, or any org you want extra confirmation for.",
        width - 3,
      ).map((line) => ` ${t.fg("dim", line)}`),
      "",
      ` ${t.fg("muted", "Current:")} ${current || t.fg("dim", "(none)")}`,
      "",
      ` ${t.fg("accent", "e")} ${t.fg("text", "edit aliases")}`,
      ` ${t.fg("accent", "c")} ${t.fg("text", "clear aliases")}`,
    ];
  }

  private renderAdvanced(width: number): string[] {
    const t = this.theme;
    return [
      ` ${t.fg("accent", themeBold(t, "Advanced Rule Overrides"))}`,
      "",
      ` ${t.fg("muted", "Rule definitions:")} ${t.fg("dim", userConfigPath())}`,
      ` ${t.fg("muted", "Rule behaviors:")}  ${t.fg("dim", `${globalSettingsPath()} → sfPi.guardrail.ruleBehaviors`)}`,
      "",
      ...wrapLines(
        "Custom rules added to the advanced override file appear automatically in the matching rules page. Use the panel for Off / Ask me / Block behavior changes; use JSON only for rule definitions.",
        width - 3,
      ).map((line) => ` ${t.fg("dim", line)}`),
    ];
  }

  private handleHomeInput(data: string): void {
    if (matchesKey(data, "up")) this.moveSelection("home", SECTION_ITEMS.length, -1);
    else if (matchesKey(data, "down")) this.moveSelection("home", SECTION_ITEMS.length, 1);
    else if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      const item = SECTION_ITEMS[this.selected("home")];
      if (!item) return;
      if (item.value === "files" || item.value === "commands" || item.value === "orgs") {
        this.page = { kind: "rules", section: item.value, filter: "", filtering: false };
      } else if (item.value === "aliases") {
        this.page = { kind: "aliases", editing: false, draft: productionAliasesText(this.config) };
      } else if (item.value === "advanced") {
        this.page = { kind: "advanced" };
      }
    } else if (matchesKey(data, "left")) {
      this.cycleTimeout(-1);
    } else if (matchesKey(data, "right") || matchesKey(data, "space")) {
      this.cycleTimeout(1);
    }
  }

  private handleRulesInput(data: string): void {
    if (this.page.kind !== "rules") return;
    const rows = this.filteredRuleRows(this.page.section);
    if (matchesKey(data, "up")) this.moveSelection(this.page.section, rows.length, -1);
    else if (matchesKey(data, "down")) this.moveSelection(this.page.section, rows.length, 1);
    else if (matchesKey(data, "left")) this.cycleRule(this.page.section, rows, -1);
    else if (matchesKey(data, "right") || matchesKey(data, "space"))
      this.cycleRule(this.page.section, rows, 1);
    else if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      const row = rows[this.selected(this.page.section)];
      if (row) this.page = { kind: "rule-detail", section: this.page.section, ruleId: row.id };
    } else if (data === "/") {
      this.page = { ...this.page, filtering: true };
    }
  }

  private handleRuleDetailInput(data: string): void {
    const page = this.page;
    if (page.kind !== "rule-detail") return;
    const row = this.ruleRows(page.section).find((candidate) => candidate.id === page.ruleId);
    if (!row) return;
    if (matchesKey(data, "left")) this.cycleOneRule(row, -1);
    else if (matchesKey(data, "right") || matchesKey(data, "space")) this.cycleOneRule(row, 1);
  }

  private handleAliasesInput(data: string): void {
    if (this.page.kind !== "aliases") return;
    if (data === "e" || data === "E") {
      this.startAliasEdit();
    } else if (data === "c" || data === "C") {
      updateProductionAliasesFromText("");
      this.reload("Protected org aliases cleared.");
      this.page = { kind: "aliases", editing: false, draft: "" };
    }
  }

  private handleAliasEditInput(data: string): void {
    if (this.page.kind !== "aliases" || !this.page.editing) return;
    this.aliasInput?.handleInput(data);
  }

  private startAliasEdit(): void {
    const draft = productionAliasesText(this.config);
    const input = new Input();
    input.setValue(draft);
    input.focused = this.focused;
    input.onSubmit = (value) => this.saveAliasEdit(value);
    input.onEscape = () => this.cancelAliasEdit();
    this.aliasInput = input;
    this.page = { kind: "aliases", editing: true, draft };
  }

  private saveAliasEdit(value: string): void {
    const aliases = updateProductionAliasesFromText(value);
    this.aliasInput = undefined;
    this.reload(
      aliases.length > 0
        ? `Protected org aliases saved: ${aliases.join(", ")}`
        : "Protected org aliases cleared.",
    );
    this.page = { kind: "aliases", editing: false, draft: productionAliasesText(this.config) };
  }

  private cancelAliasEdit(): void {
    this.aliasInput = undefined;
    this.page = { kind: "aliases", editing: false, draft: productionAliasesText(this.config) };
  }

  private handleRuleFilterInput(data: string): void {
    if (this.page.kind !== "rules") return;
    if (matchesKey(data, "escape")) {
      this.page = { ...this.page, filtering: false, filter: "" };
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.page = { ...this.page, filtering: false };
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.page = { ...this.page, filter: this.page.filter.slice(0, -1) };
      return;
    }
    if (isPrintable(data)) this.page = { ...this.page, filter: this.page.filter + data };
  }

  private goBack(): void {
    if (this.page.kind === "home") {
      this.done(undefined);
      return;
    }
    if (this.page.kind === "rule-detail") {
      this.page = { kind: "rules", section: this.page.section, filter: "", filtering: false };
      return;
    }
    this.page = { kind: "home" };
  }

  private ruleRows(section: RulePanelSection): RuleRow[] {
    const descriptors = buildGuardrailPreferenceDescriptors(this.config).filter(
      (descriptor) => descriptor.section === section,
    );
    return descriptors.flatMap((descriptor) => {
      const id = ruleIdFromPreferenceKey(descriptor.key);
      if (!id) return [];
      const definition = this.findDefinition(section, id);
      if (!definition) return [];
      return [
        {
          id,
          descriptor,
          definition,
          definitionSource: resolveRuleDefinitionSource(section, id),
          behaviorSource: resolveRuleBehaviorSource(section, id),
        },
      ];
    });
  }

  private filteredRuleRows(section: RulePanelSection): RuleRow[] {
    const rows = this.ruleRows(section);
    const filter =
      this.page.kind === "rules" && this.page.section === section
        ? this.page.filter.trim().toLowerCase()
        : "";
    if (!filter) return rows;
    return rows.filter((row) =>
      `${row.id} ${row.descriptor.label} ${row.descriptor.description}`
        .toLowerCase()
        .includes(filter),
    );
  }

  private findDefinition(
    section: RulePanelSection,
    id: string,
  ): PolicyRule | CommandPattern | OrgAwareRule | undefined {
    if (section === "files") return this.config.policies.rules.find((rule) => rule.id === id);
    if (section === "commands")
      return this.config.commandGate.patterns.find((pattern) => pattern.id === id);
    return this.config.orgAwareGate.rules.find((rule) => rule.id === id);
  }

  private renderRuleLine(row: RuleRow, selected: boolean, width: number): string {
    const t = this.theme;
    const prefix = selected ? t.fg("accent", " → ") : "   ";
    const behavior = displayValue(preferenceValue(this.config, row.descriptor.key));
    const idWidth = Math.max(20, width - 28);
    const id = truncateToWidth(row.id, idWidth, "…");
    const idPadding = " ".repeat(Math.max(1, idWidth - visibleWidth(id) + 1));
    const source = sourceLabel(row.definitionSource, row.behaviorSource);
    const text = `${prefix}${selected ? t.fg("accent", id) : id}${idPadding}${t.fg(selected ? "accent" : "muted", behavior.padEnd(10))}${t.fg("dim", source)}`;
    return truncateToWidth(text, width, "");
  }

  private ruleSummaryLines(row: RuleRow, width: number): string[] {
    const t = this.theme;
    const source = `Definition: ${row.definitionSource} · Behavior: ${row.behaviorSource}`;
    const summary = [
      row.descriptor.label,
      row.descriptor.example ? `Example: ${row.descriptor.example}` : undefined,
      source,
    ]
      .filter((line): line is string => !!line)
      .join(" · ");
    return [`     ${t.fg("dim", truncateToWidth(summary, Math.max(20, width - 6), "…"))}`];
  }

  private cycleRule(section: RulePanelSection, rows: RuleRow[], direction: -1 | 1): void {
    const row = rows[this.selected(section)];
    if (row) this.cycleOneRule(row, direction);
  }

  private cycleOneRule(row: RuleRow, direction: -1 | 1): void {
    const current = preferenceValue(this.config, row.descriptor.key);
    const currentIndex = Math.max(0, row.descriptor.values.indexOf(current));
    const nextIndex =
      (currentIndex + direction + row.descriptor.values.length) % row.descriptor.values.length;
    const nextValue = row.descriptor.values[nextIndex];
    if (!nextValue) return;
    updateUserPreference(row.descriptor.key, nextValue, this.config);
    this.reload(`${row.id}: ${displayValue(nextValue)} saved.`);
  }

  private cycleTimeout(direction: -1 | 1): void {
    const descriptor = GUARDRAIL_PREFERENCE_DESCRIPTORS[0];
    if (!descriptor) return;
    const current = preferenceValue(this.config, descriptor.key);
    const currentIndex = Math.max(0, descriptor.values.indexOf(current));
    const nextIndex =
      (currentIndex + direction + descriptor.values.length) % descriptor.values.length;
    const nextValue = descriptor.values[nextIndex];
    if (!nextValue) return;
    updateUserPreference(descriptor.key, nextValue, this.config);
    this.reload(`Approval timeout: ${displayValue(nextValue)} saved.`);
  }

  private selected(key: string): number {
    return this.selectedByPage[key] ?? 0;
  }

  private moveSelection(key: string, count: number, direction: -1 | 1): void {
    if (count <= 0) return;
    this.selectedByPage[key] = (this.selected(key) + direction + count) % count;
  }

  private pageTitle(): string | undefined {
    switch (this.page.kind) {
      case "home":
        return undefined;
      case "rules":
        return rulesTitle(this.page.section);
      case "rule-detail":
        return `${rulesTitle(this.page.section)} › ${this.page.ruleId}`;
      case "aliases":
        return "Protected org aliases";
      case "advanced":
        return "Advanced Rule Overrides";
    }
  }

  private footerText(): string {
    if (this.page.kind === "home") return "↑↓ move · Enter open · ←/→ timeout · Esc back";
    if (this.page.kind === "rules") {
      return this.page.filtering
        ? "type filter · Enter apply · Esc clear"
        : "↑↓ move · ←/→ behavior · Enter details · / filter · Esc back";
    }
    if (this.page.kind === "rule-detail") return "←/→ behavior · Esc back";
    if (this.page.kind === "aliases") {
      return this.page.editing
        ? "type aliases · Enter save aliases · Esc cancel"
        : "e edit · c clear · Esc back";
    }
    if (this.page.kind === "advanced") return "Esc back";
    return "↑↓ move · ←/→ change · saved immediately · Esc back";
  }

  private reload(message: string): void {
    const loaded = loadConfig();
    this.config = loaded.config;
    this.source = loaded.source;
    this.lastSavedMessage = message;
  }

  private jsonPreview(
    definition: PolicyRule | CommandPattern | OrgAwareRule,
    width: number,
  ): string[] {
    const text = JSON.stringify(definition, null, 2);
    return text
      .split("\n")
      .slice(0, 12)
      .map((line) => truncateToWidth(line, Math.max(20, width - 5), "…"));
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

function wrapLines(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function isPrintable(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

function themeBold(theme: Theme, text: string): string {
  return theme.bold(text);
}

export const createConfigPanel: ConfigPanelFactory = (theme, _cwd, scope, done) => {
  return new SfGuardrailConfigPanel(theme, scope, done);
};
