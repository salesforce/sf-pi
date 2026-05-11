/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for schemes that don't have a queryable SF metadata record
 * but are intended to "just work" at runtime.
 *
 *   standardInvocableAction:// — built-in Salesforce invocable, always available
 *   http:// / https://         — outbound HTTP via External Service / Named Credential
 *   mcp:// / mcpTool://        — MCP server (external)
 *   slack://                   — Slack invocable (external bridge)
 *   byon://                    — Bring-your-own-network endpoint
 *
 * Resolving these requires either deep org introspection (Named
 * Credentials, MCP server config) that's beyond pre-flight scope, or
 * is impossible to verify locally (any HTTP URL). We treat them as
 * "always resolvable" so publish proceeds; the runtime is responsible
 * for actual binding.
 */

import type { TargetResolver } from "../types.ts";

export const alwaysAvailableResolver: TargetResolver = {
  schemes: ["standardInvocableAction", "http", "https", "mcp", "mcpTool", "slack", "byon"],
  metadataLabel: "Built-in / external (no pre-flight)",
  async resolve(_conn, names) {
    // Pretend we found everything. The runtime decides.
    return new Set(names);
  },
};
