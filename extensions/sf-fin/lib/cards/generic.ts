/* SPDX-License-Identifier: Apache-2.0 */
/** The fallback card for results without a purpose-built presenter. */
import type { FinCard } from "../fin-card.ts";
import { stripStatus, textLines, humanize, str, isString } from "./helpers.ts";
import type { CardInput } from "./helpers.ts";

// ─── Generic ───────────────────────────────────────────────────────────────

/** Errors and results without a purpose-built card: the first line, then the rest quietly. */
export function genericCard(input: CardInput): FinCard {
  const d = input.details;
  const lines = textLines(input.text);
  const procedureMissing = /Procedure not found/iu.test(input.text);
  const title = procedureMissing
    ? "Procedure not found"
    : input.ok
      ? humanize([str(d.action) ?? "status", str(d.operation)].filter(Boolean).join(" · "))
      : `${humanize(str(d.operation) ?? str(d.action) ?? "sf_fin")} did not finish`;
  const first = stripStatus(lines[0] ?? "");
  return {
    status: input.ok ? "info" : "error",
    icon: input.ok ? "🐟" : "🛑",
    title,
    meta: [str(d.procedureId) ?? str(d.connectorId), str(d.targetOrg)].filter(isString),
    lead: procedureMissing ? `Fin has no procedure with this id.` : first,
    blocks:
      lines.length > 1
        ? [
            {
              kind: "text",
              text: [
                {
                  text: lines
                    .slice(1)
                    .map((l) => l.trim())
                    .join("  "),
                  tone: "muted",
                },
              ],
            },
          ]
        : [],
    next: procedureMissing
      ? [{ text: "List your procedures:  " }, { text: "/sf-fin sdk manifest", tone: "info" }]
      : undefined,
  };
}
