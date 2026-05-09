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

import { DynamicBorder, getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { resolveUiGlyphs } from "../../../lib/common/ui-glyphs.ts";
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
  const glyphs = resolveUiGlyphs(ctx.cwd);

  await ctx.ui.custom<void>((tui, theme, _kb, done) => {
    const items: SettingItem[] = [
      {
        id: "defaultFields",
        label: `${glyphs.status} Result detail · Default search detail`,
        description: "Controls default body detail for search and research results.",
        currentValue: working.defaultFields,
        values: ["auto", "summary", "preview", "full"],
      },
      {
        id: "threadBodies",
        label: `${glyphs.status} Result detail · Thread/history bodies`,
        description: "Controls message body detail when reading threads and channel history.",
        currentValue: working.threadBodies,
        values: ["full", "preview"],
      },
      {
        id: "showWidget",
        label: `${glyphs.controls} UI feedback · Research summary widget`,
        description: "Shows or hides the lightweight Slack research activity widget.",
        currentValue: working.showWidget,
        values: ["on", "off"],
      },
      {
        id: "compactPermalinks",
        label: `${glyphs.links} Links · Compact permalinks (OSC 8)`,
        description: "Renders cleaner terminal hyperlinks when the terminal supports OSC 8 links.",
        currentValue: working.compactPermalinks,
        values: ["on", "off"],
      },
    ];

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
