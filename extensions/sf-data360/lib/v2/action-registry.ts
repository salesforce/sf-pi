/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Data 360 v2 action registry.
 *
 * This is the runtime reader for the generated registry/v2/actions.json file.
 * It gives v2 family tools a compact, stable Interface while keeping the
 * 200+ operation catalog behind an on-demand action map.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Data360V2ActionDefinition, Data360V2ToolName } from "./action-types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACTIONS_PATH = path.resolve(__dirname, "..", "..", "registry", "v2", "actions.json");

let cache: Data360V2ActionDefinition[] | undefined;

export function getData360Actions(): Data360V2ActionDefinition[] {
  cache ??= JSON.parse(readFileSync(ACTIONS_PATH, "utf8")) as Data360V2ActionDefinition[];
  return cache;
}

export function getData360ActionsForTool(tool: Data360V2ToolName): Data360V2ActionDefinition[] {
  return getData360Actions().filter((action) => action.tool === tool);
}

export function findData360Action(
  tool: Data360V2ToolName,
  actionName: string,
): Data360V2ActionDefinition | undefined {
  const name = actionName.trim();
  return getData360Actions().find(
    (action) =>
      action.tool === tool &&
      (action.action === name || action.aliases?.some((alias) => alias === name)),
  );
}

export function searchData360Actions(
  query: string,
  options: { tool?: Data360V2ToolName; limit?: number } = {},
): Data360V2ActionDefinition[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
  const candidates = options.tool ? getData360ActionsForTool(options.tool) : getData360Actions();
  return candidates
    .map((action) => ({ action, score: scoreAction(action, terms) }))
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.action.tool.localeCompare(b.action.tool) ||
        a.action.action.localeCompare(b.action.action),
    )
    .slice(0, options.limit ?? 12)
    .map((entry) => entry.action);
}

function scoreAction(action: Data360V2ActionDefinition, terms: string[]): number {
  if (terms.length === 0) return 1;
  const haystack = [
    action.tool,
    action.action,
    action.phase,
    action.family,
    action.capability ?? "",
    action.description,
    action.tips ?? "",
    ...(action.aliases ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
}

export function summarizeAction(action: Data360V2ActionDefinition): Record<string, unknown> {
  return {
    tool: action.tool,
    action: action.action,
    phase: action.phase,
    family: action.family,
    capability: action.capability,
    implementation: action.implementation,
    safety: action.safety,
    description: action.description,
    requiredParams: action.requiredParams,
    optionalParams: action.optionalParams,
    endpoint: action.endpoint,
    aliases: action.aliases,
    tips: action.tips,
  };
}
