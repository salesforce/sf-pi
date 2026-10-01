/* SPDX-License-Identifier: Apache-2.0 */
/** Pure Manager pages for exact tool conflicts and observed contract drift. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ObservedToolDrift } from "./observed-tools.ts";
import type { McpPreset } from "./presets.ts";
import type { McpToolDetail } from "./tool-catalog.ts";
import type { ActiveToolConflict } from "./tool-conflicts.ts";
import { exposureLabel } from "./tool-policy.ts";
import { wrapText } from "./panel-pages.ts";

export function renderToolConflictReviewPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  conflicts: readonly ActiveToolConflict[];
  cursor: number;
}): string[] {
  const { theme: t, width } = input;
  const windowSize = 8;
  const start = Math.max(
    0,
    Math.min(input.cursor - Math.floor(windowSize / 2), input.conflicts.length - windowSize),
  );
  const end = Math.min(input.conflicts.length, start + windowSize);
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Tool Conflict Review`))}`,
    "",
    ...wrapText(
      "Review exact MCP tools that overlap enabled SF Pi capability owners. SF MCP never disables the native owner.",
      Math.max(24, width - 2),
    ).map((line) => ` ${t.fg("muted", line)}`),
    "",
    ` ${t.fg("dim", `Showing ${start + 1}–${end} of ${input.conflicts.length} conflicts`)}`,
    "",
  ];
  for (let index = start; index < end; index++) {
    const conflict = input.conflicts[index];
    if (!conflict) continue;
    const selected = index === input.cursor;
    const heading = `${selected ? "❯" : " "} ${conflict.toolName}`;
    lines.push(
      ` ${selected ? t.fg("accent", t.bold(truncateToWidth(heading, Math.max(20, width - 2)))) : t.fg("text", truncateToWidth(heading, Math.max(20, width - 2)))}`,
    );
    lines.push(
      ...wrapText(
        `${conflict.capability} · ${relationshipLabel(conflict)} · recommended ${exposureLabel(conflict.recommendedExposure)}`,
        Math.max(24, width - 5),
      ).map((line) => `   ${t.fg("dim", line)}`),
      ...wrapText(`Owners: ${conflict.owners.join(" · ")}`, Math.max(24, width - 5)).map(
        (line) => `   ${t.fg("warning", line)}`,
      ),
    );
    if (selected) {
      lines.push(
        ...wrapText(conflict.reason, Math.max(24, width - 5)).map(
          (line) => `   ${t.fg("muted", line)}`,
        ),
      );
      if (conflict.broad) {
        lines.push(
          ...wrapText(
            "Broad meta-tool: exposure applies to the dispatcher, not to individual operations behind it.",
            Math.max(24, width - 5),
          ).map((line) => `   ${t.fg("warning", `⚠ ${line}`)}`),
        );
      }
    }
    lines.push("");
  }
  lines.push(
    ...wrapText(
      "N prefer SF Pi recommendation · B keep both · Enter inspect · ↑/↓ navigate · Esc overview",
      Math.max(24, width - 2),
    ).map((line) => ` ${t.fg("dim", line)}`),
  );
  return lines;
}

export function renderToolConflictDetailPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  conflict: ActiveToolConflict;
  tool?: McpToolDetail;
}): string[] {
  const { theme: t, width, conflict } = input;
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › ${conflict.toolName} Conflict`))}`,
    "",
    ` ${t.fg("accent", t.bold(conflict.toolName))}`,
  ];
  if (input.tool) {
    lines.push(
      ...wrapText(input.tool.description, Math.max(24, width - 3)).map(
        (line) => ` ${t.fg("text", line)}`,
      ),
    );
  }
  lines.push(
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "OWNERSHIP")}`,
    `    Capability         ${t.fg("text", conflict.capability)}`,
    `    Relationship       ${t.fg("text", relationshipLabel(conflict))}`,
    `    Owners             ${t.fg("warning", conflict.owners.join(" · "))}`,
    `    Recommendation     ${t.fg("text", exposureLabel(conflict.recommendedExposure))}`,
    "",
    ...wrapText(conflict.reason, Math.max(24, width - 3)).map((line) => ` ${t.fg("muted", line)}`),
  );
  if (conflict.broad) {
    lines.push(
      "",
      ...wrapText(
        "This is a broad meta-tool. Pi can expose or hide the MCP tool, but it cannot allow only selected operations behind the dispatcher.",
        Math.max(24, width - 3),
      ).map((line) => ` ${t.fg("warning", `⚠ ${line}`)}`),
    );
  }
  lines.push("", ` ${t.fg("dim", "Enter/Esc back to conflicts")}`);
  return lines;
}

export function renderToolDriftPage(input: {
  theme: Theme;
  width: number;
  preset: McpPreset;
  drift: ObservedToolDrift;
  tools: readonly McpToolDetail[];
  canRepair: boolean;
  canReviewPresetUpdate: boolean;
}): string[] {
  const { theme: t, width } = input;
  const tools = new Map(input.tools.map((tool) => [tool.name, tool]));
  const lines = [
    ` ${t.fg("accent", t.bold(`← Esc back   ☁ SF MCP › ${input.preset.label} › Contract Drift Review`))}`,
    "",
    ` ${t.fg("warning", t.bold("⚠  The live MCP contract differs from the reviewed preset"))}`,
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", `ADDED · ${input.drift.added.length}`)}`,
  ];
  if (input.drift.added.length === 0) {
    lines.push(`    ${t.fg("dim", "None")}`);
  } else {
    for (const name of input.drift.added) {
      lines.push(
        `    ${t.fg("warning", name)}  ${t.fg("dim", "observed · unapproved · locked hidden")}`,
      );
      const description = tools.get(name)?.description;
      if (description) {
        lines.push(
          ...wrapText(description, Math.max(24, width - 8)).map(
            (line) => `      ${t.fg("dim", line)}`,
          ),
        );
      }
    }
  }
  lines.push(
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", `REMOVED · ${input.drift.removed.length}`)}`,
  );
  if (input.drift.removed.length === 0) {
    lines.push(`    ${t.fg("dim", "None")}`);
  } else {
    for (const name of input.drift.removed) {
      lines.push(`    ${t.fg("warning", name)}  ${t.fg("dim", "documented · unavailable")}`);
      const description = tools.get(name)?.description;
      if (description) {
        lines.push(
          ...wrapText(description, Math.max(24, width - 8)).map(
            (line) => `      ${t.fg("dim", line)}`,
          ),
        );
      }
    }
  }
  lines.push(
    "",
    ` ${t.fg("accent", "▰")} ${t.fg("muted", "NEXT")}`,
    ...wrapText(
      "Added tools require a reviewed SF MCP preset revision before they can be exposed. Runtime observation never approves them.",
      Math.max(24, width - 8),
    ).map((line) => `    ${t.fg("text", line)}`),
  );
  if (input.canRepair) {
    lines.push(
      ...wrapText(
        "R Repair exposure policy — set removed reviewed tools to Hidden and review the exact native diff.",
        Math.max(24, width - 8),
      ).map((line) => `    ${t.fg("accent", line)}`),
    );
  }
  if (input.canReviewPresetUpdate) {
    lines.push(
      ...wrapText(
        "U Review preset update — continue to the existing diff-reviewed reset workflow.",
        Math.max(24, width - 8),
      ).map((line) => `    ${t.fg("accent", line)}`),
    );
  }
  if (!input.canRepair && !input.canReviewPresetUpdate) {
    lines.push(`    ${t.fg("dim", "No native configuration repair is currently available.")}`);
  }
  lines.push("", ` ${t.fg("dim", "R repair · U preset update · Esc overview")}`);
  return lines;
}

function relationshipLabel(conflict: ActiveToolConflict): string {
  if (conflict.broad) return "Broad meta-tool";
  return conflict.relationship === "direct" ? "Direct overlap" : "Partial overlap";
}
