/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI setup overlay for the SF LLM Gateway provider.
 *
 * This is now a thin wrapper that:
 *   1. Draws the border box (╭─╮ │ │ ╰─╯)
 *   2. Delegates content rendering and input to GatewayConfigPanelComponent
 *
 * The standalone overlay is opened by `/sf-llm-gateway-internal setup`.
 * The same config panel is also hosted inside the sf-pi Extension Manager overlay.
 */

import { type Focusable, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  type GatewayConfig,
  type SavedGatewayConfig,
  normalizeBaseUrl,
  getGatewayConfig,
  readGatewaySavedConfig,
  writeGatewaySavedConfig,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
} from "./config.ts";
import { GatewayConfigPanelComponent } from "./config-panel.ts";

// -------------------------------------------------------------------------------------------------
// Types (preserved for backward compatibility with the extension entry point)
// -------------------------------------------------------------------------------------------------

export type SetupOverlayAction = "save-enable" | "save" | "disable";

export type SetupOverlayResult = {
  action: SetupOverlayAction;
  savedBaseUrl?: string;
  savedApiKey?: string;
  savedExclusiveScope?: boolean | null;
};

export type SetupOverlayState = {
  scopeSaved: SavedGatewayConfig;
  effectiveConfig: GatewayConfig;
  higherSavedBaseUrl?: string;
  higherSavedApiKey?: string;
  higherSavedExclusiveScope?: boolean;
  lowerSavedBaseUrl?: string;
  lowerSavedApiKey?: string;
  lowerSavedExclusiveScope?: boolean;
};

// -------------------------------------------------------------------------------------------------
// State builders (still used by the extension entry point for non-overlay flows)
// -------------------------------------------------------------------------------------------------

export function getSetupOverlayState(cwd: string, scope: "global" | "project"): SetupOverlayState {
  const globalSaved = readGatewaySavedConfig(globalGatewayConfigPath());
  const projectSaved = readGatewaySavedConfig(projectGatewayConfigPath(cwd));

  return {
    scopeSaved: scope === "project" ? projectSaved : globalSaved,
    effectiveConfig: getGatewayConfig(cwd),
    higherSavedBaseUrl: scope === "global" ? normalizeBaseUrl(projectSaved.baseUrl) : undefined,
    higherSavedApiKey: scope === "global" ? projectSaved.apiKey?.trim() || undefined : undefined,
    higherSavedExclusiveScope: scope === "global" ? projectSaved.exclusiveScope : undefined,
    lowerSavedBaseUrl: scope === "project" ? normalizeBaseUrl(globalSaved.baseUrl) : undefined,
    lowerSavedApiKey: scope === "project" ? globalSaved.apiKey?.trim() || undefined : undefined,
    lowerSavedExclusiveScope: scope === "project" ? globalSaved.exclusiveScope : undefined,
  };
}

export function saveSetupOverlayInputs(
  cwd: string,
  scope: "global" | "project",
  result: SetupOverlayResult,
): void {
  const configPath =
    scope === "project" ? projectGatewayConfigPath(cwd) : globalGatewayConfigPath();
  const saved = readGatewaySavedConfig(configPath);

  if (result.savedBaseUrl) {
    saved.baseUrl = result.savedBaseUrl;
  } else {
    delete saved.baseUrl;
  }

  if (result.savedApiKey) {
    saved.apiKey = result.savedApiKey;
  } else {
    delete saved.apiKey;
  }

  if ("savedExclusiveScope" in result) {
    if (result.savedExclusiveScope == null) {
      delete saved.exclusiveScope;
    } else {
      saved.exclusiveScope = result.savedExclusiveScope;
    }
  }

  writeGatewaySavedConfig(configPath, saved);
}

// -------------------------------------------------------------------------------------------------
// Shared text viewport helper (used by both this overlay and config-panel)
// -------------------------------------------------------------------------------------------------

export function getTextViewport(
  value: string,
  cursor: number,
  maxWidth: number,
): { text: string; cursorIndex: number } {
  if (maxWidth <= 1) {
    return { text: value.slice(0, maxWidth), cursorIndex: 0 };
  }

  if (value.length <= maxWidth) {
    return { text: value, cursorIndex: Math.min(cursor, value.length) };
  }

  const contentWidth = Math.max(1, maxWidth - 2);
  let start = Math.max(0, cursor - Math.floor(contentWidth / 2));
  start = Math.min(start, Math.max(0, value.length - contentWidth));
  const end = Math.min(value.length, start + contentWidth);
  let text = value.slice(start, end);
  let cursorIndex = Math.min(cursor - start, text.length);

  if (start > 0 && text.length > 0) {
    text = `…${text.slice(1)}`;
    cursorIndex = Math.max(1, cursorIndex);
  }
  if (end < value.length && text.length > 0) {
    text = `${text.slice(0, Math.max(0, text.length - 1))}…`;
  }

  return { text, cursorIndex };
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

// -------------------------------------------------------------------------------------------------
// Standalone wrapper overlay (draws border, delegates to config panel)
// -------------------------------------------------------------------------------------------------

/**
 * Standalone overlay wrapper for `/sf-llm-gateway-internal setup`.
 *
 * Draws the border box and title, then delegates all content rendering
 * and input handling to GatewayConfigPanelComponent.
 */
export class GatewaySetupOverlayComponent implements Focusable {
  focused = false;
  private panel: GatewayConfigPanelComponent;

  constructor(
    private readonly theme: Theme,
    private readonly scope: "global" | "project",
    private readonly cwd: string,
    state: SetupOverlayState,
    private readonly done: (result: SetupOverlayResult | undefined) => void,
  ) {
    // Create the config panel, translating its result to the legacy SetupOverlayResult.
    // The standalone overlay still uses the old result type for backward compat with
    // the extension entry point's save/enable/disable orchestration.
    this.panel = new GatewayConfigPanelComponent(
      theme,
      scope,
      cwd,
      (panelResult: ConfigPanelResult | undefined) => {
        if (!panelResult) {
          this.done(undefined);
          return;
        }
        // The config panel now handles saving internally.
        // Signal the extension entry point to re-run its enable/disable logic.
        const configPath =
          scope === "project" ? projectGatewayConfigPath(cwd) : globalGatewayConfigPath();
        const saved = readGatewaySavedConfig(configPath);

        if (panelResult.needsReload) {
          const action: SetupOverlayAction = saved.enabled === false ? "disable" : "save-enable";
          this.done({
            action,
            savedBaseUrl: saved.baseUrl,
            savedApiKey: saved.apiKey,
            savedExclusiveScope: saved.exclusiveScope ?? null,
          });
        } else {
          this.done({
            action: "save",
            savedBaseUrl: saved.baseUrl,
            savedApiKey: saved.apiKey,
            savedExclusiveScope: saved.exclusiveScope ?? null,
          });
        }
      },
    );
  }

  handleInput(data: string): void {
    // Propagate focus state to the panel
    this.panel.focused = this.focused;
    this.panel.handleInput(data);
  }

  render(width: number): string[] {
    const innerWidth = Math.max(48, width - 2);
    const lines: string[] = [];
    const theme = this.theme;

    const row = (content: string = "") => {
      const padded = padAnsi(truncateToWidth(content, innerWidth, ""), innerWidth);
      return `${theme.fg("border", "│")}${padded}${theme.fg("border", "│")}`;
    };

    // Top border
    lines.push(theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));

    // Title
    lines.push(row(` ${theme.fg("accent", theme.bold("SF LLM Gateway Internal Setup"))}`));

    // Delegate content to panel
    this.panel.focused = this.focused;
    const contentRows = this.panel.renderContent(innerWidth);
    for (const contentRow of contentRows) {
      lines.push(row(contentRow));
    }

    // Bottom border
    lines.push(theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return lines;
  }

  invalidate(): void {
    this.panel.invalidate();
  }
}
