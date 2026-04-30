/* SPDX-License-Identifier: Apache-2.0 */
/** Register slack_time_range, a deterministic date normalizer for Slack tools. */
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { SlackTimeRangeParams } from "./types.ts";
import { resolveSlackTimeRange, type SlackTimeRangeInput } from "./time-range.ts";

interface TimeRangeToolCallArgs {
  expression?: string;
  timezone?: string;
  week_starts_on?: string;
  calendar_mode?: string;
}

interface TimeRangeToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    expression?: string;
    range?: {
      oldest?: string;
      latest?: string;
      start_iso?: string;
      end_iso?: string;
    };
    slack?: {
      search?: {
        query_suffix?: string;
      };
    };
  };
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

export function registerTimeRangeTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackTimeRangeParams>({
    name: "slack_time_range",
    label: "Slack Time Range",
    description:
      "Resolve human time expressions into deterministic Slack timestamp/date boundaries. " +
      "Use this before Slack history/search calls when the user says things like last week, yesterday, last 7 days, or an explicit date range.",
    promptSnippet:
      "Convert human time ranges into Slack history oldest/latest timestamps and search after:/before: operators",
    // Cross-tool routing ("call slack_time_range first for human dates") lives on the
    // `slack` tool. This single bullet only names the output fields.
    promptGuidelines: [
      "slack_time_range returns oldest/latest for slack action:'history', query_suffix for raw slack search, and since/before for slack_research. Pass those values through unchanged — do not recompute Unix timestamps with bash/python.",
    ],
    parameters: SlackTimeRangeParams,

    renderCall(args: TimeRangeToolCallArgs, theme: Theme) {
      const bits = [args.expression ? `"${args.expression}"` : "?"];
      if (args.timezone) bits.push(args.timezone);
      if (args.week_starts_on) bits.push(`week:${args.week_starts_on}`);
      if (args.calendar_mode) bits.push(args.calendar_mode);
      return callLabel("Slack Time Range", bits.join(" · "), theme);
    },

    renderResult(result: TimeRangeToolRenderResult, _opts, theme: Theme) {
      const details = result.details || {};
      if (!details.ok) {
        return new Text(
          theme.fg("error", "✗ " + (getFirstText(result.content) || "Time range failed")),
          0,
          0,
        );
      }
      const suffix = details.slack?.search?.query_suffix || "";
      return new Text(theme.fg("success", "✓ ") + theme.fg("muted", suffix), 0, 0);
    },

    async execute(_toolCallId, params) {
      try {
        const result = resolveSlackTimeRange(params as SlackTimeRangeInput);
        return {
          content: [{ type: "text", text: formatTimeRangeResult(result) }],
          details: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Could not resolve Slack time range: ${message}` }],
          details: { ok: false, action: "time_range", reason: "invalid_range", error: message },
        };
      }
    },
  });
}

function formatTimeRangeResult(result: ReturnType<typeof resolveSlackTimeRange>): string {
  const lines: string[] = [];
  lines.push("Slack time range resolved:");
  lines.push(`Expression: ${result.expression}`);
  lines.push(`Timezone: ${result.timezone}`);
  lines.push(`Anchor: ${result.anchor_iso}`);
  lines.push(`Range: ${result.range.start_iso} → ${result.range.end_iso} (end exclusive)`);
  lines.push("");
  lines.push("Use with slack history:");
  lines.push(`oldest: "${result.slack.history.oldest}"`);
  lines.push(`latest: "${result.slack.history.latest}"`);
  lines.push("");
  lines.push("Use with Slack search:");
  lines.push(result.slack.search.query_suffix);
  lines.push("");
  lines.push("Use with slack_research:");
  lines.push(`since: "${result.slack.research.since}"`);
  lines.push(`before: "${result.slack.research.before}"`);

  if (result.notes.length > 0) {
    lines.push("");
    lines.push("Notes:");
    for (const note of result.notes) lines.push(`- ${note}`);
  }

  return lines.join("\n");
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) return "";
  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
