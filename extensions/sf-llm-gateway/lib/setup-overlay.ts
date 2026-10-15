/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TUI setup overlay for the SF LLM Gateway provider.
 *
 * This is now a thin wrapper that:
 *   1. Draws the border box (╭─╮ │ │ ╰─╯)
 *   2. Delegates content rendering and input to GatewayConfigPanelComponent
 *
 * The standalone overlay is opened by `/sf-llm-gateway setup`.
 * The same config panel is also hosted inside the sf-pi Extension Manager overlay.
 */

import { type Focusable, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  type GatewayConfig,
  type SavedGatewayConfig,
  normalizeBaseUrl,
  getGatewayConfig,
  readGatewaySavedConfig,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
} from "./config.ts";
import { GatewayConfigPanelComponent } from "./config-panel.ts";

// -------------------------------------------------------------------------------------------------
// Types shared with the extension entry point
// -------------------------------------------------------------------------------------------------

export type SetupOverlayAction = "open-token" | "import-claude" | "save";

export type SetupOverlayResult = {
  action: SetupOverlayAction;
  baseUrl?: string;
};

export type SetupOverlayState = {
  scopeSaved: SavedGatewayConfig;
  effectiveConfig: GatewayConfig;
  higherSavedBaseUrl?: string;
  higherSavedExclusiveScope?: boolean;
  lowerSavedBaseUrl?: string;
  lowerSavedExclusiveScope?: boolean;
};

// -------------------------------------------------------------------------------------------------
// State builder shared by the standalone overlay and Manager panel
// -------------------------------------------------------------------------------------------------

export function getSetupOverlayState(cwd: string, scope: "global" | "project"): SetupOverlayState {
  const globalSaved = readGatewaySavedConfig(globalGatewayConfigPath());
  const projectSaved = readGatewaySavedConfig(projectGatewayConfigPath(cwd));

  return {
    scopeSaved: scope === "project" ? projectSaved : globalSaved,
    effectiveConfig: getGatewayConfig(cwd),
    higherSavedBaseUrl: scope === "global" ? normalizeBaseUrl(projectSaved.baseUrl) : undefined,
    higherSavedExclusiveScope: scope === "global" ? projectSaved.exclusiveScope : undefined,
    lowerSavedBaseUrl: scope === "project" ? normalizeBaseUrl(globalSaved.baseUrl) : undefined,
    lowerSavedExclusiveScope: scope === "project" ? globalSaved.exclusiveScope : undefined,
  };
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
 * Standalone overlay wrapper for `/sf-llm-gateway setup`.
 *
 * Draws the border box and title, then delegates all content rendering
 * and input handling to GatewayConfigPanelComponent.
 */
export class GatewaySetupOverlayComponent implements Focusable {
  focused = false;
  private panel: GatewayConfigPanelComponent;

  constructor(
    private readonly theme: Theme,
    scope: "global" | "project",
    cwd: string,
    private readonly done: (result: SetupOverlayResult | undefined) => void,
    projectTrusted = false,
  ) {
    // Translate the shared panel's save and external-action results into the
    // standalone overlay result consumed by the extension entry point.
    this.panel = new GatewayConfigPanelComponent(
      theme,
      scope,
      cwd,
      (panelResult: ConfigPanelResult | undefined) => {
        if (!panelResult) {
          this.done(undefined);
          return;
        }
        const gatewayResult = panelResult as ConfigPanelResult & {
          gatewayAction?: SetupOverlayAction;
          baseUrl?: string;
        };
        if (gatewayResult.gatewayAction === "open-token") {
          this.done({ action: "open-token", baseUrl: gatewayResult.baseUrl });
          return;
        }
        if (gatewayResult.gatewayAction === "import-claude") {
          this.done({ action: "import-claude" });
          return;
        }

        // The panel already persisted the non-secret settings. Network and
        // lifecycle work remain explicit commands outside this setup overlay.
        this.done({ action: "save" });
      },
      { externalActions: true, closeOnSave: true, projectTrusted },
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
    lines.push(row(` ${theme.fg("accent", theme.bold("SF LLM Gateway Setup"))}`));

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
