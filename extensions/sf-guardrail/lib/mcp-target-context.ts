/* SPDX-License-Identifier: Apache-2.0 */
/** Resolve only the environment class proven by a Salesforce Hosted MCP URL. */
import { existsSync, readFileSync } from "node:fs";
import { globalAgentPath, projectConfigPath } from "../../../lib/common/pi-paths.ts";

export type McpTargetType = "production" | "sandbox" | "unknown";

export function resolveMcpTargetType(
  cwd: string | undefined,
  serverName: string,
  projectTrusted = false,
): McpTargetType {
  const project =
    cwd && projectTrusted
      ? readServerUrl(projectConfigPath(cwd, "mcp.json"), serverName)
      : undefined;
  const global = readServerUrl(globalAgentPath("mcp.json"), serverName);
  const value = project ?? global;
  if (!value) return "unknown";

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "api.salesforce.com") return "unknown";
    if (
      url.pathname.startsWith("/platform/mcp/v1/sandbox/") ||
      url.pathname.startsWith("/platform/mcp/v1/data/sandbox/")
    ) {
      return "sandbox";
    }
    if (
      url.pathname.startsWith("/platform/mcp/v1/platform/") ||
      url.pathname.startsWith("/platform/mcp/v1/data/")
    ) {
      return "production";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

function readServerUrl(filePath: string, serverName: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const root = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isRecord(root) || !isRecord(root.mcpServers)) return undefined;
    const server = root.mcpServers[serverName];
    if (!isRecord(server) || typeof server.url !== "string") return undefined;
    return server.url;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
