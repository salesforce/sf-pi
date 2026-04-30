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
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AuthTestResponse } from "./types.ts";
import { slackApi, getGrantedScopes } from "./api.ts";

/** A tool is enabled if the token has *any* scope in its requirement list. */
interface ToolScopeRequirement {
  tool: string;
  anyOf: string[];
}

// Keep this table next to the probe so the source of truth for tool \u2194 scope
// mapping is co-located. Updates here should match the scopes requested by
// DEFAULT_SCOPES in types.ts (and any docs in the README scope-planning table).
//
// Notes:
//   - slack_canvas: `read` needs files:read OR canvases:read (the latter is
//     the modern API path via canvases.sections.lookup). Per-action gating
//     for `create`/`edit` happens inside the tool itself because it needs
//     canvases:write.
//   - slack: the `search` action can use `search:read` (coarse, legacy) OR
//     any of the granular `search:read.*` scopes (newer workspaces).
//   - slack_research: same search requirements as `slack`.
//   - slack_time_range / slack_resolve: pure helpers / resolver \u2014 not gated.
const TOOL_SCOPE_REQUIREMENTS: ToolScopeRequirement[] = [
  {
    tool: "slack_channel",
    anyOf: ["channels:read", "groups:read", "im:read", "mpim:read"],
  },
  { tool: "slack_file", anyOf: ["files:read"] },
  { tool: "slack_user", anyOf: ["users:read"] },
  {
    tool: "slack_canvas",
    anyOf: ["canvases:read", "files:read"],
  },
  {
    tool: "slack",
    anyOf: [
      "search:read",
      "search:read.public",
      "search:read.private",
      "search:read.im",
      "search:read.mpim",
      "search:read.files",
      "search:read.users",
      "channels:history",
      "groups:history",
    ],
  },
  {
    tool: "slack_research",
    anyOf: [
      "search:read",
      "search:read.public",
      "search:read.private",
      "search:read.im",
      "search:read.mpim",
    ],
  },
  {
    // slack_send uses chat.postMessage. `chat:write` covers channels the
    // user is in; `chat:write.public` additionally covers public channels
    // the user hasn't joined. Either is enough to register the tool —
    // per-action preflight inside send-tool.ts enforces the more specific
    // token-type rule (user tokens only).
    tool: "slack_send",
    anyOf: ["chat:write", "chat:write.public"],
  },
];

export interface ProbeResult {
  gatedTools: string[];
  /** Scopes requested by DEFAULT_SCOPES (or SLACK_SCOPES) that Slack did not
   *  grant to this token. Surfaced by `/sf-slack refresh` as a one-line
   *  warning so users immediately see scope drift. */
  missingGrantedScopes: string[];
  /** Whether the X-OAuth-Scopes header was captured at all. When false we
   *  didn't gate anything because we cannot tell what's missing. */
  scopesKnown: boolean;
}

/** Pure helper so tests can verify the gating logic without a live Slack call. */
export function computeGatedTools(
  granted: Set<string> | null,
  registeredTools: string[],
): string[] {
  if (!granted) return [];
  const gated: string[] = [];
  for (const { tool, anyOf } of TOOL_SCOPE_REQUIREMENTS) {
    if (!registeredTools.includes(tool)) continue;
    const hasAny = anyOf.some((scope) => granted.has(scope));
    if (!hasAny) gated.push(tool);
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

export async function probeAndGateTools(
  pi: ExtensionAPI,
  token: string,
  signal?: AbortSignal,
  requestedScopes: string[] = [],
): Promise<ProbeResult> {
  // One cheap call whose only purpose is to populate the granted-scope cache
  // via the X-OAuth-Scopes response header (captured inside slackApi).
  await slackApi<AuthTestResponse>("auth.test", token, {}, signal);

  const granted = getGrantedScopes();
  const registeredTools = pi.getAllTools().map((tool) => tool.name);

  const gatedTools = computeGatedTools(granted, registeredTools);
  const missingGrantedScopes = computeMissingGrantedScopes(granted, requestedScopes);

  if (gatedTools.length > 0) {
    const activeTools = pi.getActiveTools().filter((toolName) => !gatedTools.includes(toolName));
    pi.setActiveTools(activeTools);
  }

  return {
    gatedTools,
    missingGrantedScopes,
    scopesKnown: granted !== null,
  };
}
