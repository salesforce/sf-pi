/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Scope probing & tool gating for sf-slack (P2, header-driven).
 *
 * Design:
 *   We do a single cheap `auth.test` call and read the `X-OAuth-Scopes`
 *   response header, which Slack populates on every OK response. That header
 *   is the authoritative list of scopes the workspace actually granted this
 *   token. We then gate tools by scope requirements expressed as
 *   "any-of" groups (a tool is enabled if the token has any scope in its
 *   requirement list).
 *
 * Rationale for replacing the old synthetic-call probe:
 *   - The old probe made two fake calls (conversations.info on C000000000
 *     and files.list) and checked for `missing_scope`. That covered only two
 *     scopes and burned API quota on each session_start.
 *   - The header-driven probe covers *every* scope Slack recognizes with one
 *     cheap call, and never reports false positives when the call fails for
 *     an unrelated reason (channel not found, rate limited, etc.).
 *   - If the header is not captured for any reason (e.g. `auth.test` itself
 *     fails), we conservatively gate nothing rather than gate everything.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AuthTestResponse } from "./types.ts";
import { slackApi, getGrantedScopes, type SlackTokenType } from "./api.ts";
import {
  ALL_SLACK_TOOL_NAMES,
  DIRECTORY_SCOPES,
  HISTORY_SCOPES,
  SEARCH_SCOPES,
} from "./capabilities.ts";

/** A tool is enabled if the token has *any* scope in its requirement list. */
interface ToolScopeRequirement {
  tool: string;
  anyOf: readonly string[];
  tokenTypes?: readonly SlackTokenType[];
}

// Keep this table next to the probe so the source of truth for tool ↔ scope
// mapping is co-located. Updates here should match the scopes requested by
// DEFAULT_SCOPES in types.ts (and any docs in the README scope-planning table).
//
// Notes:
//   - slack_canvas: `read` needs files:read OR canvases:read (the latter is
//     the modern API path via canvases.sections.lookup). Per-action gating
//     for `create`/`edit` happens inside the tool itself because it needs
//     canvases:write.
//   - slack: the `search` action can use `search:read` (coarse, legacy) OR
//     any of the granular `search:read.*` scopes (newer workspaces); history
//     actions can still be useful when only a known channel/DM ID is available.
//   - slack_research: same search requirements as `slack`.
//   - slack_time_range / slack_resolve: pure helpers / resolver — not gated.
const TOOL_SCOPE_REQUIREMENTS: ToolScopeRequirement[] = [
  {
    tool: "slack_channel",
    anyOf: DIRECTORY_SCOPES,
  },
  { tool: "slack_file", anyOf: ["files:read"] },
  { tool: "slack_user", anyOf: ["users:read"] },
  {
    tool: "slack_canvas",
    anyOf: ["canvases:read", "files:read"],
  },
  {
    tool: "slack",
    anyOf: [...SEARCH_SCOPES, ...HISTORY_SCOPES],
  },
  {
    tool: "slack_research",
    anyOf: SEARCH_SCOPES,
  },
  {
    // slack_send posts as the authenticated user. `chat:write.public` is a
    // bot/app posting enhancer and is not sufficient for this user-token tool.
    tool: "slack_send",
    anyOf: ["chat:write"],
    tokenTypes: ["user"],
  },
  {
    // slack_schedule uses Slack's public chat.scheduleMessage / list / delete
    // endpoints. Keep it behind the same user-token chat:write gate as
    // slack_send because schedule/delete are Slack write operations.
    tool: "slack_schedule",
    anyOf: ["chat:write"],
    tokenTypes: ["user"],
  },
];

export interface ProbeResult {
  gatedTools: string[];
  /** Scopes requested by DEFAULT_SCOPES (or SLACK_SCOPES) that Slack did not
   *  grant to this token. Surfaced as neutral partial-grant context because
   *  workspaces may intentionally approve only a subset of requested scopes. */
  missingGrantedScopes: string[];
  /** Whether the X-OAuth-Scopes header was captured at all. When false we
   *  didn't gate anything because we cannot tell what's missing. */
  scopesKnown: boolean;
}

/** Pure helper so tests can verify the gating logic without a live Slack call. */
export function computeGatedTools(
  granted: Set<string> | null,
  registeredTools: string[],
  tokenType: SlackTokenType = "user",
): string[] {
  if (!granted) return [];
  const gated: string[] = [];
  for (const { tool, anyOf, tokenTypes } of TOOL_SCOPE_REQUIREMENTS) {
    if (!registeredTools.includes(tool)) continue;
    const hasAny = anyOf.some((scope) => granted.has(scope));
    const tokenAllowed = !tokenTypes || tokenTypes.includes(tokenType);
    if (!hasAny || !tokenAllowed) gated.push(tool);
  }
  return gated;
}

/** Pure helper so tests can verify requested-vs-granted comparison. */
export function computeMissingGrantedScopes(
  granted: Set<string> | null,
  requested: string[],
): string[] {
  if (!granted) return [];
  return requested.filter((scope) => scope && !granted.has(scope));
}

export function computeGrantedRequestedScopeCount(
  granted: Set<string> | null,
  requested: string[],
): number {
  if (!granted) return 0;
  return requested.filter((scope) => scope && granted.has(scope)).length;
}

/**
 * Apply tool gating from the scopes already captured by a prior Slack API
 * response (usually the session_start `auth.test`).
 *
 * This is the boot-friendly path: session_start already calls `auth.test` to
 * validate the token and detect identity, and slackApi captures
 * `X-OAuth-Scopes` from that response. Reusing the captured header avoids a
 * second redundant `auth.test` while preserving first-turn tool gating.
 */
export function gateToolsFromGrantedScopes(
  pi: ExtensionAPI,
  requestedScopes: string[] = [],
  tokenType: SlackTokenType = "user",
): ProbeResult {
  const granted = getGrantedScopes();
  const registeredTools = pi.getAllTools().map((tool) => tool.name);

  const gatedTools = computeGatedTools(granted, registeredTools, tokenType);
  const missingGrantedScopes = computeMissingGrantedScopes(granted, requestedScopes);

  if (granted) applyScopeGate(pi, gatedTools);

  return {
    gatedTools,
    missingGrantedScopes,
    scopesKnown: granted !== null,
  };
}

/** Hide every Slack-owned tool while preserving non-Slack active tools. */
const scopeGateBaselineByPi = new WeakMap<ExtensionAPI, string[]>();

export function deactivateSlackTools(pi: ExtensionAPI): void {
  scopeGateBaselineByPi.delete(pi);
  const activeTools = pi
    .getActiveTools()
    .filter(
      (toolName) =>
        !ALL_SLACK_TOOL_NAMES.includes(toolName as (typeof ALL_SLACK_TOOL_NAMES)[number]),
    );
  pi.setActiveTools(activeTools);
}

function applyScopeGate(pi: ExtensionAPI, gatedTools: string[]): void {
  const registeredTools = pi.getAllTools().map((tool) => tool.name);
  const registeredToolSet = new Set(registeredTools);
  const activeNonSlack = pi
    .getActiveTools()
    .filter(
      (toolName) =>
        !ALL_SLACK_TOOL_NAMES.includes(toolName as (typeof ALL_SLACK_TOOL_NAMES)[number]),
    );
  const baselineSlack = getScopeGateBaseline(pi, registeredToolSet);
  const activeSlack = baselineSlack.filter(
    (toolName) => registeredToolSet.has(toolName) && !gatedTools.includes(toolName),
  );
  pi.setActiveTools([...activeNonSlack, ...activeSlack]);
}

function getScopeGateBaseline(pi: ExtensionAPI, registeredTools: ReadonlySet<string>): string[] {
  const existing = scopeGateBaselineByPi.get(pi);
  if (existing) return existing;

  const baseline = pi
    .getActiveTools()
    .filter(
      (toolName) =>
        registeredTools.has(toolName) &&
        ALL_SLACK_TOOL_NAMES.includes(toolName as (typeof ALL_SLACK_TOOL_NAMES)[number]),
    );
  scopeGateBaselineByPi.set(pi, baseline);
  return baseline;
}

export async function probeAndGateTools(
  pi: ExtensionAPI,
  token: string,
  signal?: AbortSignal,
  requestedScopes: string[] = [],
  tokenType: SlackTokenType = "user",
): Promise<ProbeResult> {
  // One cheap call whose only purpose is to populate the granted-scope cache
  // via the X-OAuth-Scopes response header (captured inside slackApi).
  await slackApi<AuthTestResponse>("auth.test", token, {}, signal);

  return gateToolsFromGrantedScopes(pi, requestedScopes, tokenType);
}
