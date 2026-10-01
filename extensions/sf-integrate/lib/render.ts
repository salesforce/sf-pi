/* SPDX-License-Identifier: Apache-2.0 */
/** Human-facing SF Integrate Result Card rendering. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import {
  renderSfPiResultCardPanel,
  renderSfPiToolCallLine,
  type SfPiResultCard,
} from "../../../lib/common/display/result-card.ts";
import type { SfIntegrateParams, ToolResult } from "./types.ts";

export function renderIntegrationCall(args: SfIntegrateParams, theme: Theme): Text {
  return new Text(
    renderSfPiToolCallLine(
      {
        icon: "🔗",
        label: "SF Integrate",
        action: args.action,
        subject: args.named_credential_name ?? args.app_name ?? args.mcp_preset,
        scope: args.target_org,
      },
      theme,
    ),
    0,
    0,
  );
}

export function renderIntegrationResult(
  result: ToolResult,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
): Component {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "🔗 SF Integrate running…"), 0, 0);
  }
  const card = asCard(result.details?.card);
  if (!card) return new Text(result.content[0]?.text ?? "", 0, 0);
  return renderSfPiResultCardPanel(card, { expanded: options.expanded }, theme);
}

function asCard(value: unknown): SfPiResultCard | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SfPiResultCard>;
  if (!candidate.tool || typeof candidate.title !== "string") return undefined;
  if (typeof candidate.summary !== "string" || typeof candidate.status !== "string") {
    return undefined;
  }
  return candidate as SfPiResultCard;
}
