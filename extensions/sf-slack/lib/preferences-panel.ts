/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-slack settings` TUI — pi-native SettingsList (docs/tui.md Pattern 3).
 *
 * Naming convention (sf-pi standard):
 *   - `lib/command-panel.ts`     — the no-args slash-command status & actions panel
 *   - `lib/config-panel.ts`      — ConfigPanelFactory invoked by sf-pi-manager
 *   - `lib/preferences-panel.ts` — mutable user-preference editor (this file)
 *
 * Renders from the descriptor seam in preferences.ts. This keeps the current
 * TUI/RPC adapters thin and gives a future Pi-native settings menu one place
 * to read labels, descriptions, allowed values, and defaults.
 *
 * This module only owns the UI adapters; persistence is handled by the caller
 * so the extension can stay the single source of truth for `pi.appendEntry`.
 */

import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { resolveUiGlyphs, type UiGlyphs } from "../../../lib/common/ui-glyphs.ts";
import {
  SLACK_PREFERENCE_DESCRIPTORS,
  applyPreferenceValue,
  type SlackPreferenceKey,
  type SlackPreferenceSection,
  type SlackPreferences,
} from "./preferences.ts";

export interface PreferencesPanelOptions {
  /** Called when the user changes a row. The caller is responsible for
   *  persisting via pi.appendEntry and updating in-memory preferences. */
  onChange: (prefs: SlackPreferences) => void;
}

/**
 * Backwards-compatible alias so older imports keep working while the
 * canonical name lands across the repo.
 */
export type SettingsPanelOptions = PreferencesPanelOptions;

/** Opens the SettingsList overlay. Returns when the user dismisses it. */
export async function openPreferencesPanel(
  ctx: ExtensionContext,
  current: SlackPreferences,
  options: PreferencesPanelOptions,
): Promise<void> {
  const working: SlackPreferences = { ...current };
  const glyphs = resolveUiGlyphs(ctx.cwd);

  if (!ctx.hasUI) {
    console.info(renderPreferencesSummary(working));
    return;
  }

  if (ctx.mode !== "tui") {
    await openPreferencesDialog(ctx, working, options);
    return;
  }

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const items = buildSettingItems(working, glyphs);

    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("borderAccent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold("💬 SF Slack Settings")), 1, 0));
    container.addChild(
      new Text(
        theme.fg("dim", "Configure how Slack results are shown to the agent and in the UI."),
        1,
        0,
      ),
    );
    container.addChild(
      new Text(
        theme.fg(
          "muted",
          `Sections: ${glyphs.status} Result detail · ${glyphs.controls} UI feedback · ${glyphs.links} Links`,
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
        const next = applyPreferenceValue(working, id as SlackPreferenceKey, newValue);
        if (!next) return;
        Object.assign(working, next);
        options.onChange({ ...working });
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

function buildSettingItems(working: SlackPreferences, glyphs: UiGlyphs): SettingItem[] {
  return SLACK_PREFERENCE_DESCRIPTORS.map((descriptor) => ({
    id: descriptor.key,
    label: `${sectionIcon(descriptor.section, glyphs)} ${sectionLabel(descriptor.section)} · ${descriptor.label}`,
    description: descriptor.description,
    currentValue: String(working[descriptor.key]),
    values: descriptor.values.map(String),
  }));
}

async function openPreferencesDialog(
  ctx: ExtensionContext,
  working: SlackPreferences,
  options: PreferencesPanelOptions,
): Promise<void> {
  while (true) {
    const entries = SLACK_PREFERENCE_DESCRIPTORS.map((descriptor, index) => ({
      descriptor,
      option: `${index + 1}. ${sectionLabel(descriptor.section)} · ${descriptor.label} — current: ${working[descriptor.key]}`,
    }));
    const doneOption = "Done";
    const selected = await ctx.ui.select("SF Slack Settings", [
      ...entries.map((entry) => entry.option),
      doneOption,
    ]);
    if (!selected || selected === doneOption) return;

    const entry = entries.find((candidate) => candidate.option === selected);
    if (!entry) return;

    const valueEntries = entry.descriptor.values.map((value) => {
      const stringValue = String(value);
      return {
        value: stringValue,
        option:
          stringValue === working[entry.descriptor.key] ? `${stringValue} (current)` : stringValue,
      };
    });
    const pickedValue = await ctx.ui.select(
      `${entry.descriptor.label}\n${entry.descriptor.description}`,
      valueEntries.map((candidate) => candidate.option),
    );
    const valueEntry = valueEntries.find((candidate) => candidate.option === pickedValue);
    if (!valueEntry) continue;

    const next = applyPreferenceValue(working, entry.descriptor.key, valueEntry.value);
    if (!next) continue;
    Object.assign(working, next);
    options.onChange({ ...working });
    ctx.ui.notify(`${entry.descriptor.label}: ${valueEntry.value}`, "info");
  }
}

function renderPreferencesSummary(prefs: SlackPreferences): string {
  return [
    "SF Slack settings require an interactive Pi UI or RPC UI client.",
    "Current preferences:",
    ...SLACK_PREFERENCE_DESCRIPTORS.map(
      (descriptor) => `- ${descriptor.label}: ${prefs[descriptor.key]}`,
    ),
  ].join("\n");
}

function sectionLabel(section: SlackPreferenceSection): string {
  switch (section) {
    case "result":
      return "Result detail";
    case "feedback":
      return "UI feedback";
    case "links":
      return "Links";
  }
}

function sectionIcon(section: SlackPreferenceSection, glyphs: UiGlyphs): string {
  switch (section) {
    case "result":
      return glyphs.status;
    case "feedback":
      return glyphs.controls;
    case "links":
      return glyphs.links;
  }
}

// Legacy alias kept for one release while callers migrate to openPreferencesPanel.
export const openSettingsPanel = openPreferencesPanel;
