/* SPDX-License-Identifier: Apache-2.0 */
/** Human-facing SF Fin Result Card rendering (model text stays in `content`). */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import {
  renderSfPiProgressText,
  renderSfPiResultCardPanel,
  type SfPiProgress,
  type SfPiResultCard,
} from "../../../lib/common/display/result-card.ts";

interface FinToolResult {
  content: Array<{ type: string; text?: string }>;
  details?: Record<string, unknown>;
}

export function renderFinResult(
  result: FinToolResult,
  options: { expanded?: boolean; isPartial?: boolean },
  theme: Theme,
): Component {
  if (options.isPartial) {
    const progress = asProgress(result.details?.progress);
    return new Text(
      progress
        ? renderSfPiProgressText(progress, theme)
        : theme.fg("warning", `🐟 ${firstText(result) || "SF Fin running…"}`),
      0,
      0,
    );
  }
  const card = asCard(result.details?.card);
  if (!card) return new Text(firstText(result), 0, 0);
  return renderSfPiResultCardPanel(card, { expanded: options.expanded }, theme);
}

function firstText(result: FinToolResult): string {
  return result.content.find((item) => item.type === "text")?.text ?? "";
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

function asProgress(value: unknown): SfPiProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SfPiProgress>;
  return typeof candidate.phase === "string" ? (candidate as SfPiProgress) : undefined;
}
