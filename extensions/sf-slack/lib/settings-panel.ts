/* SPDX-License-Identifier: Apache-2.0 */
/**
 * `/sf-slack settings` TUI — pi-native SettingsList (docs/tui.md Pattern 3).
 *
 * Exposes three user-facing toggles that the LLM-side and TUI-side code both
 * read via preferences.ts:
 *
 *   1. Default search detail   (auto | summary | preview | full) — P2
 *   2. Research summary widget (on | off)                  — P4
 *   3. Compact permalinks      (on | off)                  — P5
 *
 * This module only owns the UI; persistence is handled by the caller so the
 * extension can stay the single source of truth for `pi.appendEntry`.
 */

import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import type { DefaultFieldsMode, OnOff, SlackPreferences, ThreadBodyMode } from "./preferences.ts";

export interface SettingsPanelOptions {
  /** Called when the user changes a row. The caller is responsible for
   *  persisting via pi.appendEntry and updating in-memory preferences. */
  onChange: (prefs: SlackPreferences) => void;
}

/** Opens the SettingsList overlay. Returns when the user dismisses it. */
export async function openSettingsPanel(
  ctx: ExtensionContext,
  current: SlackPreferences,
  options: SettingsPanelOptions,
): Promise<void> {
  const working: SlackPreferences = { ...current };

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const items: SettingItem[] = [
      {
        id: "defaultFields",
        label: "Default search detail",
        currentValue: working.defaultFields,
        values: ["auto", "summary", "preview", "full"],
      },
      {
        id: "threadBodies",
        label: "Thread/history bodies",
        currentValue: working.threadBodies,
        values: ["full", "preview"],
      },
      {
        id: "showWidget",
        label: "Research summary widget",
        currentValue: working.showWidget,
        values: ["on", "off"],
      },
      {
        id: "compactPermalinks",
        label: "Compact permalinks (OSC 8)",
        currentValue: working.compactPermalinks,
        values: ["on", "off"],
      },
    ];

    const container = new Container();
    container.addChild(new Text(theme.fg("accent", theme.bold("SF Slack Settings")), 1, 1));
    container.addChild(
      new Text(theme.fg("dim", "↑↓ navigate · ←→ change value · esc to close"), 1, 0),
    );

    const settingsList = new SettingsList(
      items,
      Math.min(items.length + 2, 12),
      getSettingsListTheme(),
      (id, newValue) => {
        if (id === "defaultFields") {
          working.defaultFields = newValue as DefaultFieldsMode;
        } else if (id === "showWidget") {
          working.showWidget = newValue as OnOff;
        } else if (id === "compactPermalinks") {
          working.compactPermalinks = newValue as OnOff;
        } else if (id === "threadBodies") {
          working.threadBodies = newValue as ThreadBodyMode;
        }
        options.onChange({ ...working });
      },
      () => done(),
    );
    container.addChild(settingsList);

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
