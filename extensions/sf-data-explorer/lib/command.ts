/* SPDX-License-Identifier: Apache-2.0 */
import type { ExplorerMode } from "./types.ts";

export interface ParsedCommandArgs {
  mode?: ExplorerMode;
  /** Optional object/table API name for deep linking, e.g. Account or ssot__Individual__dlm. */
  object?: string;
  org: string;
  forceRefresh: boolean;
  help: boolean;
}

const MODES = new Set(["soql", "sosl", "sql"]);
const REFRESH_FLAGS = new Set(["refresh", "reload", "force", "--refresh", "--force", "-f"]);
const HELP_FLAGS = new Set(["help", "--help", "-h", "?"]);

export const DEFAULT_ORG = process.env.SF_DATA_EXPLORER_DEFAULT_ORG?.trim() || "default";

export function isExplorerMode(value: string | undefined): value is ExplorerMode {
  return !!value && MODES.has(value);
}

export function parseCommandArgs(args: string, defaultOrg = DEFAULT_ORG): ParsedCommandArgs {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const help = parts.some((p) => HELP_FLAGS.has(p.toLowerCase()));
  const forceRefresh = parts.some((p) => REFRESH_FLAGS.has(p.toLowerCase()));
  const modeToken = parts.find((p) => isExplorerMode(p.toLowerCase()))?.toLowerCase() as
    | ExplorerMode
    | undefined;
  const positional = parts.filter((p) => {
    const lower = p.toLowerCase();
    return !isExplorerMode(lower) && !REFRESH_FLAGS.has(lower) && !HELP_FLAGS.has(lower);
  });
  // Supported forms:
  //   /sf-data-explorer soql wh            -> org=wh
  //   /sf-data-explorer soql Account wh    -> object=Account, org=wh
  //   /sf-data-explorer sql ssot__X__dlm wh -> object=ssot__X__dlm, org=wh
  const object = positional.length >= 2 ? positional[0] : undefined;
  const org = positional[1] ?? positional[0] ?? defaultOrg;
  return { mode: modeToken, object, org, forceRefresh, help };
}

export function buildHelpText(): string {
  return `SF Data Explorer\n\nUsage:\n  /sf-data-explorer soql [target-org] [refresh]\n  /sf-data-explorer sosl [target-org] [refresh]\n  /sf-data-explorer sql  [target-org] [refresh]\n  /sf-data-explorer soql [object-api-name] [target-org] [refresh]\n  /sf-data-explorer sosl [object-api-name] [target-org] [refresh]\n  /sf-data-explorer sql  [table-api-name]  [target-org] [refresh]\n\nExamples:\n  /sf-data-explorer soql wh\n  /sf-data-explorer sosl wh\n  /sf-data-explorer sql wh refresh\n  /sf-data-explorer soql Account wh\n  /sf-data-explorer sosl Contact wh\n  /sf-data-explorer sql ssot__Individual__dlm wh\n\nPrimary keys: ? help, t switch explorer, w WHERE/search term, l LIMIT, e edit query, r run, c copy, s save.\nRead-only: v1 only issues describe, query, search, and Data 360 SELECT SQL calls.`;
}

export function modeLabel(mode: ExplorerMode): string {
  if (mode === "soql") return "SOQL Explorer";
  if (mode === "sosl") return "SOSL Explorer";
  return "Data 360 SQL Explorer";
}
