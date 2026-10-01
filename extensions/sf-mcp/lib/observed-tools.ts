/* SPDX-License-Identifier: Apache-2.0 */
/** Session-local observed MCP tool contracts. Pi remains the connection-state owner. */
import { canonicalMcpServerName } from "./mcp-config.ts";
import { approvedToolsForResolution, type McpPreset, type McpResolution } from "./presets.ts";

export interface ObservedToolDrift {
  status: "not-observed" | "clean" | "review";
  observed: string[];
  added: string[];
  removed: string[];
}

let observedByServer = new Map<string, string[]>();

export function captureObservedMcpTools(tools: readonly { name: string }[]): void {
  const next = new Map<string, Set<string>>();
  for (const tool of tools) {
    const identity = parseRuntimeToolName(tool.name);
    if (!identity) continue;
    const names = next.get(identity.serverName) ?? new Set<string>();
    names.add(identity.toolName);
    next.set(identity.serverName, names);
  }
  observedByServer = new Map(
    [...next.entries()].map(([server, names]) => [server, [...names].sort()] as const),
  );
}

export function inspectObservedToolDrift(
  preset: McpPreset,
  resolution: McpResolution,
): ObservedToolDrift {
  const observed = observedByServer.get(canonicalMcpServerName(preset.serverName));
  if (!observed) return { status: "not-observed", observed: [], added: [], removed: [] };
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
  if (separator <= 0 || separator === identity.length - 2) return undefined;
  return {
    serverName: canonicalMcpServerName(identity.slice(0, separator)),
    toolName: identity.slice(separator + 2),
  };
}
