/* SPDX-License-Identifier: Apache-2.0 */
/** Pi-normalized MCP server and tool identity helpers. */

export interface McpToolIdentity {
  serverName: string;
  toolName: string;
}

/**
 * Pi 0.99.2 normalizes hyphens in MCP namespace names to underscores.
 * Apply the same canonical form when comparing runtime names with mcp.json keys.
 */
export function canonicalizeMcpServerName(serverName: string): string {
  return serverName.replace(/-/g, "_");
}

export function parseMcpToolIdentity(toolName: string): McpToolIdentity | undefined {
  const match = toolName.match(/^mcp__([A-Za-z0-9_-]+)__([A-Za-z0-9_-]+)$/);
  const serverName = match?.[1];
  const offeredToolName = match?.[2];
  if (!serverName || !offeredToolName) return undefined;
  return {
    serverName: canonicalizeMcpServerName(serverName),
    toolName: offeredToolName,
  };
}
