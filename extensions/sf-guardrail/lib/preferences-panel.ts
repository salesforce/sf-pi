/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-guardrail settings` TUI — pi-native SettingsList.
 */
import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import type { GuardrailConfig } from "./types.ts";
import {
  buildGuardrailPreferenceDescriptors,
  preferenceValue,
  updateUserPreference,
  type GuardrailPreferenceDescriptor,
} from "./preferences.ts";

export async function openGuardrailPreferencesPanel(
  ctx: ExtensionContext,
  config: GuardrailConfig,
): Promise<void> {
  if (!ctx.hasUI) {
    console.info(renderPreferencesSummary(config));
    return;
  }

  if (ctx.mode !== "tui") {
    await openPreferencesDialog(ctx, config);
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const working = cloneConfig(config);
    const descriptors = buildGuardrailPreferenceDescriptors(working);
    const items = buildSettingItems(working, descriptors);

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold("🛡 SF Guardrail Settings")), 1, 0));
    container.addChild(
      new Text(
        theme.fg(
          "dim",
          "Configure common safety preferences. Advanced rule overrides remain in rules.json.",
        ),
        1,
        0,
      ),
    );

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 12),
      getSettingsListTheme(),
      (id, newValue) => {
        const descriptor = descriptorFor(descriptors, id);
        if (!descriptor) return;
        updateWorkingConfig(working, descriptor, newValue);
        updateUserPreference(descriptor.key, newValue, working);
      },
      () => done(),
      { enableSearch: true },
    );
    container.addChild(settingsList);
    container.addChild(
      new Text(theme.fg("dim", "↑↓ move · ←→/Enter change · type search · Esc close"), 1, 0),
    );
    container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));

    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        settingsList.handleInput?.(data);
        tui.requestRender();
      },
    };
  });
}

function buildSettingItems(
  config: GuardrailConfig,
  descriptors: GuardrailPreferenceDescriptor[],
): SettingItem[] {
  return descriptors.map((descriptor) => ({
    id: descriptor.key,
    label: descriptor.label,
    description: descriptor.description,
    currentValue: preferenceValue(config, descriptor.key),
    values: descriptor.values,
  }));
}

async function openPreferencesDialog(
  ctx: ExtensionContext,
  config: GuardrailConfig,
): Promise<void> {
  const working = cloneConfig(config);
  const descriptors = buildGuardrailPreferenceDescriptors(working);

  while (true) {
    const entries = descriptors.map((descriptor, index) => ({
      descriptor,
      option: `${index + 1}. ${descriptor.label} — current: ${preferenceValue(working, descriptor.key)}`,
    }));
    const doneOption = "Done";
    const selected = await ctx.ui.select("SF Guardrail Settings", [
      ...entries.map((entry) => entry.option),
      doneOption,
    ]);
    if (!selected || selected === doneOption) return;

    const entry = entries.find((candidate) => candidate.option === selected);
    if (!entry) return;

    const pickedValue = await ctx.ui.select(
      `${entry.descriptor.label}\n${entry.descriptor.description}`,
      entry.descriptor.values,
    );
    if (!pickedValue) continue;

    updateWorkingConfig(working, entry.descriptor, pickedValue);
    updateUserPreference(entry.descriptor.key, pickedValue, working);
    ctx.ui.notify(`${entry.descriptor.label}: ${pickedValue}`, "info");
  }
}

function renderPreferencesSummary(config: GuardrailConfig): string {
  return [
    "SF Guardrail settings require an interactive Pi UI or RPC UI client.",
    "Current preferences:",
    ...buildGuardrailPreferenceDescriptors(config).map(
      (descriptor) => `- ${descriptor.label}: ${preferenceValue(config, descriptor.key)}`,
    ),
  ].join("\n");
}

function descriptorFor(
  descriptors: GuardrailPreferenceDescriptor[],
  id: string,
): GuardrailPreferenceDescriptor | undefined {
  return descriptors.find((descriptor) => descriptor.key === id);
}

function updateWorkingConfig(
  config: GuardrailConfig,
  descriptor: GuardrailPreferenceDescriptor,
  value: string,
): void {
  if (descriptor.key.startsWith("policies.rules.")) {
    const ruleId = descriptor.key.slice("policies.rules.".length, -".enabled".length);
    const rule = config.policies.rules.find((candidate) => candidate.id === ruleId);
    if (rule) rule.enabled = value === "on";
    return;
  }

  if (descriptor.key.startsWith("commandGate.patterns.")) {
    const patternId = descriptor.key.slice("commandGate.patterns.".length, -".enabled".length);
    const pattern = config.commandGate.patterns.find((candidate) => candidate.id === patternId);
    if (pattern) pattern.enabled = value === "on";
    return;
  }

  if (descriptor.key.startsWith("orgAwareGate.rules.")) {
    const ruleId = descriptor.key.slice("orgAwareGate.rules.".length, -".enabled".length);
    const rule = config.orgAwareGate.rules.find((candidate) => candidate.id === ruleId);
    if (rule) rule.enabled = value === "on";
    return;
  }

  switch (descriptor.key) {
    case "enabled":
      config.enabled = value === "on";
      break;
    case "features.policies":
      config.features.policies = value === "on";
      break;
    case "features.commandGate":
      config.features.commandGate = value === "on";
      break;
    case "features.orgAwareGate":
      config.features.orgAwareGate = value === "on";
      break;
    case "features.promptInjection":
      config.features.promptInjection = value === "on";
      break;
    case "confirmTimeoutMs": {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) config.confirmTimeoutMs = parsed;
      break;
    }
  }
}

function cloneConfig(config: GuardrailConfig): GuardrailConfig {
  return JSON.parse(JSON.stringify(config)) as GuardrailConfig;
}
