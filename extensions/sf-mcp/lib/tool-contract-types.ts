/* SPDX-License-Identifier: Apache-2.0 */
/** Shared reviewed MCP tool contract types and compact declaration helper. */
export type McpToolRisk = "read" | "write" | "destructive" | "mixed" | "unknown";

export interface DocumentedMcpTool {
  name: string;
  description: string;
  capability: string;
  risk: McpToolRisk;
}

export function defineTools(
  entries: readonly (readonly [string, string, string, McpToolRisk])[],
): readonly DocumentedMcpTool[] {
  return entries.map(([name, description, capability, risk]) => ({
    name,
    description,
    capability,
    risk,
  }));
}
