/* SPDX-License-Identifier: Apache-2.0 */
/** Session-local observed MCP tool contracts. Pi remains the connection-state owner. */
import { canonicalMcpServerName } from "./mcp-config.ts";
import { approvedToolsForResolution, type McpPreset, type McpResolution } from "./presets.ts";

export interface ObservedMcpToolInput {
  name: string;
  description?: string;
  parameters?: unknown;
  exposure?: string;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface ObservedMcpTool {
  name: string;
  description?: string;
  parameters?: unknown;
  exposure?: string;
  annotations?: ObservedMcpToolInput["annotations"];
}

export interface ObservedToolDrift {
  status: "not-observed" | "clean" | "review";
  observed: string[];
  added: string[];
  removed: string[];
}

let observedByServer = new Map<string, ObservedMcpTool[]>();

export function captureObservedMcpTools(tools: readonly ObservedMcpToolInput[]): void {
  const next = new Map<string, Map<string, ObservedMcpTool>>();
  for (const tool of tools) {
    const identity = parseRuntimeToolName(tool.name);
    if (!identity) continue;
    const serverTools = next.get(identity.serverName) ?? new Map<string, ObservedMcpTool>();
    serverTools.set(identity.toolName, {
      name: identity.toolName,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.parameters ? { parameters: tool.parameters } : {}),
      ...(tool.exposure ? { exposure: tool.exposure } : {}),
      ...(tool.annotations ? { annotations: { ...tool.annotations } } : {}),
    });
    next.set(identity.serverName, serverTools);
  }
  observedByServer = new Map(
    [...next.entries()].map(([server, toolsByName]) => [
      server,
      [...toolsByName.values()].sort((left, right) => left.name.localeCompare(right.name)),
    ]),
  );
}

export function getObservedMcpTools(
  preset: McpPreset,
  serverName = preset.serverName,
): ObservedMcpTool[] {
  return [...(observedByServer.get(canonicalMcpServerName(serverName)) ?? [])];
}

export function inspectObservedToolDrift(
  preset: McpPreset,
  resolution: McpResolution = "enable",
  serverName = preset.serverName,
): ObservedToolDrift {
  const observedTools = observedByServer.get(canonicalMcpServerName(serverName));
  if (!observedTools) {
    return { status: "not-observed", observed: [], added: [], removed: [] };
  }
  const observed = observedTools.map((tool) => tool.name);
  const approved = approvedToolsForResolution(preset, resolution);
  if (!approved) return { status: "clean", observed, added: [], removed: [] };

  const approvedSet = new Set(approved);
  const observedSet = new Set(observed);
  const added = observed.filter((name) => !approvedSet.has(name));
  const removed = approved.filter((name) => !observedSet.has(name)).sort();
  return {
    status: added.length > 0 || removed.length > 0 ? "review" : "clean",
    observed,
    added,
    removed,
  };
}

function parseRuntimeToolName(name: string): { serverName: string; toolName: string } | undefined {
  if (!name.startsWith("mcp__")) return undefined;
  const identity = name.slice("mcp__".length);
  const separator = identity.indexOf("__");
  if (separator <= 0 || separator >= identity.length - 2) return undefined;
  return {
    serverName: canonicalMcpServerName(identity.slice(0, separator)),
    toolName: identity.slice(separator + 2),
  };
}
