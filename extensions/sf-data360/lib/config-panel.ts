/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only settings/status panel for sf-data360.
 *
 * The extension intentionally has no persistent preferences in v1. This panel
 * exists so the sf-pi manager gives users the same standardized drill-down
 * experience as other bundled extensions: current enablement, tools, runtime,
 * safety behavior, and where to find progressive-disclosure references.
 */
import { type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import { D360_TOOL_NAME, HEADLESS_WRITE_ENV } from "./api-tool.ts";
import { D360_FACADE_TOOL_NAME } from "./facade-tool.ts";
import { D360_METADATA_TOOL_NAME } from "./metadata-tool.ts";
import { D360_PROBE_TOOL_NAME } from "./probe-tool.ts";

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

class SfData360ConfigPanel implements Focusable {
  focused = false;

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: "global" | "project",
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
    const enabled = isSfPiExtensionEnabled(this.cwd, "sf-data360");

    lines.push(pad(` ${t.fg("muted", "SF Data 360 — settings & status")}`));
    lines.push(pad(""));

    const dot = enabled ? t.fg("success", "●") : t.fg("error", "○");
    lines.push(
      pad(
        ` ${dot} ${t.fg("text", enabled ? "Enabled by default" : "Disabled by user settings")}   ${t.fg(
          "dim",
          `(scope: ${this.scope})`,
        )}`,
      ),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Runtime:")}`));
    lines.push(
      pad(`   ${t.fg("text", "REST backend")} ${t.fg("dim", "@salesforce/core Connection")}`),
    );
    lines.push(
      pad(`   ${t.fg("text", "Auth source")}   ${t.fg("dim", "Salesforce CLI org auth")}`),
    );
    lines.push(pad(`   ${t.fg("text", "MCP/Java")}      ${t.fg("dim", "not used")}`));
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "When enabled:")}`));
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${D360_FACADE_TOOL_NAME}        ${t.fg("dim", "search/examples/execute capability facade")}`,
      ),
    );
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${D360_TOOL_NAME}    ${t.fg("dim", "direct Data 360 REST calls")}`,
      ),
    );
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${D360_METADATA_TOOL_NAME} ${t.fg("dim", "compact DMO/DLO discovery")}`,
      ),
    );
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} ${D360_PROBE_TOOL_NAME}  ${t.fg("dim", "read-only readiness probes")}`,
      ),
    );
    lines.push(
      pad(
        `   ${toolDot(t, enabled)} /skill:sf-data360 ${t.fg("dim", "workflow + reference docs")}`,
      ),
    );
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "Safety:")}`));
    lines.push(pad(`   ${t.fg("dim", "•")} dry_run is available before mutating calls`));
    lines.push(
      pad(`   ${t.fg("dim", "•")} DELETE always confirms; run/publish/deploy action paths confirm`),
    );
    lines.push(pad(`   ${t.fg("dim", "•")} Headless writes require ${HEADLESS_WRITE_ENV}=1`));
    lines.push(pad(""));

    lines.push(pad(` ${t.fg("muted", "References:")}`));
    lines.push(pad(`   ${t.fg("dim", "extensions/sf-data360/skills/sf-data360/references/")}`));
    lines.push(pad(""));
    lines.push(
      pad(
        ` ${t.fg(
          "dim",
          enabled
            ? "Use /sf-data360 for status, /skill:sf-data360 for guidance. Esc to go back."
            : "Re-enable with /sf-pi enable sf-data360, then /reload. Esc to go back.",
        )}`,
      ),
    );

    return lines;
  }
}

function toolDot(t: Theme, enabled: boolean): string {
  return enabled ? t.fg("success", "●") : t.fg("dim", "○");
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfData360ConfigPanel(theme, cwd, scope, done);
};
