/* SPDX-License-Identifier: Apache-2.0 */
/** Resolve bounded target evidence proven by a configured Salesforce Hosted MCP URL. */
import { existsSync, readFileSync } from "node:fs";
import { fingerprintMcpServerConfig } from "../../../lib/common/mcp-target-attestation/store.ts";
import { globalAgentPath, projectConfigPath } from "../../../lib/common/pi-paths.ts";
import { canonicalizeMcpServerName } from "./mcp-tool-identity.ts";

export type McpTargetType = "production" | "sandbox" | "unknown";

export interface McpConfiguredTargetContext {
  targetType: McpTargetType;
  configFingerprint?: string;
}

export function resolveMcpTargetType(
  cwd: string | undefined,
  serverName: string,
  projectTrusted = false,
): McpTargetType {
  return resolveMcpConfiguredTargetContext(cwd, serverName, projectTrusted).targetType;
}

export function resolveMcpConfiguredTargetContext(
  cwd: string | undefined,
  serverName: string,
  projectTrusted = false,
): McpConfiguredTargetContext {
  const project =
    cwd && projectTrusted
      ? readServerEntry(projectConfigPath(cwd, "mcp.json"), serverName)
      : undefined;
  const global = readServerEntry(globalAgentPath("mcp.json"), serverName);
  const entry = project ?? global;
  if (!entry) return { targetType: "unknown" };
  return {
    targetType: classifyHostedUrl(entry.url),
    configFingerprint: fingerprintMcpServerConfig(entry.config),
  };
}

function classifyHostedUrl(value: string | undefined): McpTargetType {
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
      url.pathname.startsWith("/platform/mcp/v1/data/") ||
      url.pathname.startsWith("/platform/mcp/v1/analytics/")
    ) {
      return "production";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

function readServerEntry(
  filePath: string,
  serverName: string,
): { url?: string; config: Record<string, unknown> } | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const root = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isRecord(root) || !isRecord(root.mcpServers)) return undefined;
    const canonicalName = canonicalizeMcpServerName(serverName);
    const matches = Object.entries(root.mcpServers).filter(
      ([configuredName]) => canonicalizeMcpServerName(configuredName) === canonicalName,
    );
    if (matches.length !== 1) return undefined;
    const server = matches[0]?.[1];
    if (!isRecord(server)) return undefined;
    return {
      url: typeof server.url === "string" ? server.url : undefined,
      config: server,
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
