/* SPDX-License-Identifier: Apache-2.0 */
/** Mode-aware command output that never enters model context. */
import type {
  EntryRenderer,
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { openInfoPanel, type InfoPanelSeverity } from "./info-panel.ts";
import { redactDisplayText } from "./redaction.ts";

export interface HumanOnlyCommandOutput {
  title: string;
  body: string;
  severity: InfoPanelSeverity;
}

export function registerHumanOnlyCommandOutput(pi: ExtensionAPI, customType: string): void {
  pi.registerEntryRenderer<HumanOnlyCommandOutput>(
    customType,
    createHumanOnlyCommandOutputRenderer(),
  );
}

export function createHumanOnlyCommandOutputRenderer(): EntryRenderer<HumanOnlyCommandOutput> {
  return (entry, _options, theme) => {
    const title = entry.data?.title ?? "Status";
    const body = entry.data?.body ?? title;
    const severity = entry.data?.severity ?? "info";
    const color =
      severity === "success"
        ? "success"
        : severity === "warning"
          ? "warning"
          : severity === "error"
            ? "error"
            : "accent";
    return new Text(`${theme.fg(color, theme.bold(title))}\n${theme.fg("text", body)}`, 0, 0);
  };
}

export async function emitHumanOnlyCommandOutput(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  customType: string,
  output: HumanOnlyCommandOutput,
): Promise<void> {
  const safeOutput: HumanOnlyCommandOutput = {
    title: redactDisplayText(output.title),
    body: redactDisplayText(output.body.trim() || output.title),
    severity: output.severity,
  };

  if (ctx.hasUI) {
    await openInfoPanel(ctx, safeOutput);
    return;
  }

  pi.appendEntry<HumanOnlyCommandOutput>(customType, safeOutput);
  if (ctx.mode === "print") console.info(safeOutput.body);
}
