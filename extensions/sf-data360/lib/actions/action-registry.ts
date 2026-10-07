/* SPDX-License-Identifier: Apache-2.0 */
/** Runtime reader and intent search for the generated sf_data360 action catalog. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Data360ActionDefinition,
  Data360Namespace,
  Data360InternalActionDefinition,
  Data360ActionOwner,
} from "./action-types.ts";

const ACTIONS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "registry",
  "actions.json",
);
const STOP_WORDS = new Set([
  "a",
  "all",
  "and",
  "data",
  "for",
  "from",
  "in",
  "into",
  "it",
  "me",
  "my",
  "of",
  "on",
  "the",
  "this",
  "to",
  "with",
]);
const DESTRUCTIVE_TERMS = new Set(["delete", "remove", "undeploy", "abort", "deactivate"]);
let publicCache: Data360ActionDefinition[] | undefined;

export function getPublicData360Actions(): Data360ActionDefinition[] {
  publicCache ??= JSON.parse(readFileSync(ACTIONS_PATH, "utf8")) as Data360ActionDefinition[];
  return publicCache;
}

export function findPublicData360Action(actionName: string): Data360ActionDefinition | undefined {
  const name = actionName.trim();
  return getPublicData360Actions().find(
    (action) => action.action === name || action.aliases?.includes(name),
  );
}

export function searchPublicData360Actions(
  query: string,
  options: { namespace?: Data360Namespace; limit?: number } = {},
): Data360ActionDefinition[] {
  const terms = queryTerms(query);
  const explicitNamespaces = new Set(
    terms.filter((term): term is Data360Namespace =>
      [
        "discover",
        "connect",
        "prepare",
        "harmonize",
        "segment",
        "activate",
        "query",
        "semantic",
        "observe",
        "orchestrate",
        "api",
      ].includes(term),
    ),
  );
  const destructiveIntent = terms.some((term) => DESTRUCTIVE_TERMS.has(term));
  const readIntent = terms.some((term) =>
    ["show", "list", "find", "inspect", "query", "count", "sample"].includes(term),
  );
  const resourceHints = inferResourceHints(query);
  const candidates = options.namespace
    ? getPublicData360Actions().filter((action) => action.namespace === options.namespace)
    : getPublicData360Actions();
  return candidates
    .map((action) => ({
      action,
      score: scoreAction(
        action,
        terms,
        explicitNamespaces,
        destructiveIntent,
        readIntent,
        resourceHints,
      ),
    }))
    .filter((entry) => entry.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score || a.action.action.localeCompare(b.action.action))
    .slice(0, options.limit ?? 12)
    .map((entry) => entry.action);
}

function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((term) => (term.length > 4 && term.endsWith("s") ? term.slice(0, -1) : term))
    .filter((term) => term && !STOP_WORDS.has(term));
}

function scoreAction(
  action: Data360ActionDefinition,
  terms: string[],
  explicitNamespaces: Set<Data360Namespace>,
  destructiveIntent: boolean,
  readIntent: boolean,
  resourceHints: Set<string>,
): number {
  if (terms.length === 0) return 1;
  let score = 0;
  const actionText = action.action.toLowerCase();
  const actionTokens = new Set(actionText.split(/[._]+/).filter(Boolean));
  const resourceText = `${action.namespace} ${action.family}`.toLowerCase();
  const descriptionText = `${action.description} ${action.tips ?? ""}`.toLowerCase();
  for (const term of terms) {
    if (actionText === term || actionText.endsWith(`.${term}`)) score += 8;
    else if (actionTokens.has(term)) score += 5;
    if (resourceText.includes(term)) score += 3;
    if (descriptionText.includes(term)) score += 1;
  }
  if (explicitNamespaces.has(action.namespace)) score += 20;
  else if (explicitNamespaces.size > 1 && action.namespace === "orchestrate") score += 24;
  else if (explicitNamespaces.size > 0) score -= 10;
  if (resourceHints.has("dlo") && actionTokens.has("dlo")) score += 18;
  if (resourceHints.has("dmo") && actionTokens.has("dmo")) score += 18;
  if (resourceHints.has("mapping") && actionText.includes("mapping")) score += 12;
  if (resourceHints.has("workflow") && action.namespace === "orchestrate") score += 20;
  if (readIntent && action.safety === "read") score += 5;
  const terminalVerb = actionText.split(".").at(-1) ?? "";
  if (DESTRUCTIVE_TERMS.has(terminalVerb) && !destructiveIntent) score -= 25;
  if (action.safety === "destructive" && !destructiveIntent) score -= 25;
  return score;
}

function inferResourceHints(query: string): Set<string> {
  const normalized = query.toLowerCase();
  const hints = new Set<string>();
  if (/\bdata\s+lake\s+objects?\b|\bdlos?\b/.test(normalized)) hints.add("dlo");
  if (/\bdata\s+model\s+objects?\b|\bdmos?\b/.test(normalized)) hints.add("dmo");
  if (/\bmap\b|\bmapping\b/.test(normalized)) hints.add("mapping");
  if (
    /\bcsv\b/.test(normalized) &&
    /\bqueryable\b|\busable\b|\bend\s+to\s+end\b/.test(normalized)
  ) {
    hints.add("workflow");
  }
  return hints;
}

export function summarizePublicAction(action: Data360ActionDefinition): Record<string, unknown> {
  return {
    namespace: action.namespace,
    action: action.action,
    phase: action.phase,
    family: action.family,
    operationId: action.operationId,
    operationAliases: action.operationAliases,
    implementation: action.implementation,
    safety: action.safety,
    description: action.description,
    requiredParams: action.requiredParams,
    optionalParams: action.optionalParams,
    requiredAnyOf: action.requiredAnyOf,
    inputSchema: action.inputSchema,
    endpoint: action.endpoint,
    aliases: action.aliases,
    tips: action.tips,
  };
}

// Internal compatibility for the existing dispatcher while its workflows are
// progressively split into smaller SDK Modules. These names are not Pi tools.
export function getData360Actions(): Data360InternalActionDefinition[] {
  return getPublicData360Actions().map(toInternalAction);
}
export function getData360ActionsForTool(
  tool: Data360ActionOwner,
): Data360InternalActionDefinition[] {
  return getPublicData360Actions()
    .filter((action) => action.internalOwner === tool)
    .map(toInternalAction);
}
export function findData360Action(
  tool: Data360ActionOwner,
  actionName: string,
): Data360InternalActionDefinition | undefined {
  const match = getPublicData360Actions().find(
    (action) =>
      action.internalOwner === tool &&
      (action.internalAction === actionName ||
        action.internalAction.replace(".compat", "") === actionName ||
        action.aliases?.includes(actionName)),
  );
  return match ? toInternalAction(match) : undefined;
}
export function searchData360Actions(
  query: string,
  options: { tool?: Data360ActionOwner; limit?: number } = {},
): Data360InternalActionDefinition[] {
  const namespace = options.tool
    ? getPublicData360Actions().find((action) => action.internalOwner === options.tool)?.namespace
    : undefined;
  return searchPublicData360Actions(query, { namespace, limit: options.limit }).map(
    toInternalAction,
  );
}
export function summarizeAction(action: Data360InternalActionDefinition): Record<string, unknown> {
  const publicAction = getPublicData360Actions().find(
    (candidate) => candidate.action === (action.publicAction ?? action.action),
  );
  if (publicAction) return summarizePublicAction(publicAction);
  return {
    namespace: action.namespace,
    action: action.publicAction ?? action.action,
    phase: action.phase,
    family: action.family,
    implementation: action.implementation,
    safety: action.safety,
    description: action.description,
    requiredParams: action.requiredParams,
    optionalParams: action.optionalParams,
    requiredAnyOf: action.requiredAnyOf,
    inputSchema: action.inputSchema,
    endpoint: action.endpoint,
    aliases: action.aliases,
    tips: action.tips,
  };
}
function toInternalAction(action: Data360ActionDefinition): Data360InternalActionDefinition {
  return {
    tool: action.internalOwner,
    action: action.internalAction,
    publicAction: action.action,
    namespace: action.namespace,
    phase: action.phase,
    family: action.family,
    description: action.description,
    safety: action.safety,
    requiredParams: action.requiredParams,
    optionalParams: action.optionalParams,
    requiredAnyOf: action.requiredAnyOf,
    inputSchema: action.inputSchema,
    aliases: action.aliases,
    tips: action.tips,
    capability: action.capability,
    endpoint: action.endpoint,
    implementation: action.implementation,
  };
}
