/* SPDX-License-Identifier: Apache-2.0 */
/** Human render hooks for the active Data 360 v2 family tools. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { renderD360CardResult } from "../display/render.ts";

interface Data360V2RenderArgs {
  action?: string;
  target_org?: string;
  dry_run?: boolean;
  output_mode?: string;
  params?: Record<string, unknown>;
}

interface Data360V2RenderResult {
  content?: unknown[];
  details?: Record<string, unknown> & {
    card?: unknown;
    sfPi?: {
      summary?: string;
      data?: { card?: unknown };
    };
  };
}

export function renderData360V2Call(
  toolName: string,
  args: Data360V2RenderArgs,
  theme: Theme,
): Text {
  const bits = [
    args.action,
    subjectFromArgs(args),
    args.target_org,
    args.dry_run ? "dry-run" : undefined,
    args.output_mode,
  ].filter((bit): bit is string => typeof bit === "string" && bit.length > 0);
  return new Text(
    theme.fg("toolTitle", theme.bold(`☁️ ${toolTitle(toolName)} `)) +
      theme.fg("muted", bits.join(" · ")),
    0,
    0,
  );
}

export function renderData360V2Result(
  result: Data360V2RenderResult,
  opts: { isPartial?: boolean; expanded?: boolean },
  theme: Theme,
): Text {
  return renderD360CardResult(result as never, opts, theme, "☁️ Data 360 · running…");
}

function subjectFromArgs(args: Data360V2RenderArgs): string | undefined {
  const params = args.params ?? {};
  for (const key of [
    "session_id",
    "trace_id",
    "interaction_id",
    "api_name",
    "dloName",
    "dmoName",
  ]) {
    const value = params[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function toolTitle(toolName: string): string {
  return toolName.replace(/^data360_/, "Data 360 ").replace(/\b\w/g, (char) => char.toUpperCase());
}
