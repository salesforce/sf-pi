/* SPDX-License-Identifier: Apache-2.0 */
/** State and persistence for the Gateway compaction-model field in Manager settings. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  ACTIVE_COMPACTION_MODEL,
  readScopedCompactionModel,
  writeScopedCompactionModel,
  type CompactionSettingsScope,
  type GatewayCompactionModel,
  type GatewayCompactionModelOption,
} from "./compaction-settings.ts";

export type CompactionModelChoice = "inherit" | GatewayCompactionModel;
export type CompactionModelChoiceOption = {
  value: CompactionModelChoice;
  label: string;
  description: string;
};

export class GatewayCompactionModelPicker {
  private selected: CompactionModelChoice;
  private persisted: CompactionModelChoice;
  private readonly options: readonly CompactionModelChoiceOption[];

  constructor(
    private readonly cwd: string,
    private readonly scope: CompactionSettingsScope,
    models: readonly GatewayCompactionModelOption[],
  ) {
    const scoped = readScopedCompactionModel(cwd, scope);
    this.selected = scoped ?? (scope === "project" ? "inherit" : ACTIVE_COMPACTION_MODEL);
    this.persisted = this.selected;
    this.options = buildChoices(scope, this.selected, models);
  }

  current(): CompactionModelChoiceOption {
    return (
      this.options.find((option) => option.value === this.selected) ??
      this.options[0] ?? {
        value: ACTIVE_COMPACTION_MODEL,
        label: "Active conversation model",
        description: "Use Pi's active-model compaction.",
      }
    );
  }

  renderRows(theme: Theme, focused: boolean): string[] {
    const option = this.current();
    const fieldPrefix = focused ? theme.fg("accent", "▶") : theme.fg("dim", "•");
    const valuePrefix = focused ? theme.fg("accent", "→") : theme.fg("dim", " ");
    return [
      `${fieldPrefix} ${theme.fg(focused ? "accent" : "text", "Compaction model")}`,
      `  ${valuePrefix} ${theme.fg(focused ? "accent" : "text", option.label)}`,
      `   ${theme.fg("muted", option.description)}`,
      `   ${theme.fg("dim", "Applies to manual, threshold, and overflow compaction without changing the chat model.")}`,
    ];
  }

  cycle(direction: -1 | 1): void {
    const currentIndex = this.options.findIndex((option) => option.value === this.selected);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + this.options.length) % this.options.length;
    this.selected = this.options[nextIndex]?.value ?? this.selected;
  }

  isDirty(): boolean {
    return this.selected !== this.persisted;
  }

  persist(): void {
    const model = this.selected === "inherit" ? undefined : this.selected;
    writeScopedCompactionModel(this.cwd, this.scope, model);
    this.selected = model ?? (this.scope === "project" ? "inherit" : ACTIVE_COMPACTION_MODEL);
    this.persisted = this.selected;
  }
}

function buildChoices(
  scope: CompactionSettingsScope,
  current: CompactionModelChoice,
  models: readonly GatewayCompactionModelOption[],
): CompactionModelChoiceOption[] {
  const options: CompactionModelChoiceOption[] = [];
  if (scope === "project") {
    options.push({
      value: "inherit",
      label: "Inherit global preference",
      description: "Use the global SF Pi compaction model preference.",
    });
  }
  options.push({
    value: ACTIVE_COMPACTION_MODEL,
    label: "Active conversation model",
    description: "Use Pi's built-in active-model compaction.",
  });
  options.push(...models);

  if (!options.some((option) => option.value === current)) {
    options.push({
      value: current,
      label: current.split("/").at(-1) ?? current,
      description: "Saved model is not currently available; runtime will fall back to Pi.",
    });
  }

  return [...new Map(options.map((option) => [option.value, option])).values()];
}
