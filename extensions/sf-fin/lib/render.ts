/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human-facing SF Fin Result Card rendering (model text stays in `content`).
 *
 * The card is drawn flat on Pi's own tool tile (no inner box), like the Apex,
 * SOQL, and Flow cards. See fin-card.ts for the card shape and layout.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import {
  renderSfPiProgressText,
  type SfPiProgress,
} from "../../../lib/common/display/result-card.ts";
import { isFinCard, renderFinCard } from "./fin-card.ts";

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
  const card = result.details?.card;
  if (!isFinCard(card)) return new Text(firstText(result), 0, 0);
  return renderFinCard(card, options.expanded === true, theme);
}

function firstText(result: FinToolResult): string {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

function asProgress(value: unknown): SfPiProgress | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<SfPiProgress>;
  return typeof candidate.phase === "string" ? (candidate as SfPiProgress) : undefined;
}
