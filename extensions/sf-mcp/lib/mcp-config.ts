/* SPDX-License-Identifier: Apache-2.0 */
/** Strict, atomic reads and writes for Pi's native mcp.json files. */
import type { McpExposure, McpServerConfig } from "@earendil-works/pi-coding-agent";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { globalAgentPath, projectConfigPath } from "../../../lib/common/pi-paths.ts";

export type { McpExposure, McpServerConfig };

interface McpFileRoot extends Record<string, unknown> {
  mcpServers?: Record<string, McpServerConfig>;
}

export type McpConfigInspection =
  | {
      ok: true;
      exists: boolean;
      path: string;
      root: McpFileRoot;
      servers: Record<string, McpServerConfig>;
    }
  | {
      ok: false;
      exists: true;
      path: string;
      reason: "invalid-json" | "invalid-root" | "invalid-servers" | "read-failed";
      message: string;
    };

export type McpConfigMutationResult =
  | { ok: true; created: boolean; path: string }
  | {
      ok: false;
      path: string;
      reason:
        | "invalid-json"
        | "invalid-root"
        | "invalid-servers"
        | "read-failed"
        | "server-exists"
        | "server-name-conflict"
        | "server-missing"
        | "write-failed";
      message: string;
    };

export function mcpConfigPath(cwd: string, scope: "global" | "project"): string {
  return scope === "global" ? globalAgentPath("mcp.json") : projectConfigPath(cwd, "mcp.json");
}

export function inspectMcpConfig(filePath: string): McpConfigInspection {
  if (!existsSync(filePath)) {
    return { ok: true, exists: false, path: filePath, root: {}, servers: {} };
  }

  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      exists: true,
      path: filePath,
      reason: "read-failed",
      message: `Could not read ${filePath}: ${errorMessage(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      exists: true,
      path: filePath,
      reason: "invalid-json",
      message: `${filePath} contains invalid JSON. SF MCP will not overwrite it.`,
    };
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      exists: true,
      path: filePath,
      reason: "invalid-root",
      message: `${filePath} must contain a JSON object.`,
    };
  }

  const servers = parsed.mcpServers;
  if (servers !== undefined && !isRecord(servers)) {
    return {
      ok: false,
      exists: true,
      path: filePath,
      reason: "invalid-servers",
      message: `${filePath} mcpServers must be a JSON object.`,
    };
  }

  return {
    ok: true,
    exists: true,
    path: filePath,
    root: parsed as McpFileRoot,
    servers: (servers ?? {}) as Record<string, McpServerConfig>,
  };
}

export function canonicalMcpServerName(serverName: string): string {
  return serverName.replace(/-/g, "_");
}

export function findCanonicalMcpServerNames(
  servers: Readonly<Record<string, McpServerConfig>>,
  serverName: string,
): string[] {
  const canonical = canonicalMcpServerName(serverName);
  return Object.keys(servers).filter((name) => canonicalMcpServerName(name) === canonical);
}

export function upsertMcpServer(
  filePath: string,
  serverName: string,
  config: McpServerConfig,
): McpConfigMutationResult {
  const inspected = inspectMcpConfig(filePath);
  if (inspected.ok === false) return inspectionFailure(inspected);
  const matches = findCanonicalMcpServerNames(inspected.servers, serverName);
  if (matches.length > 0) {
    const exact = matches.includes(serverName);
    return {
      ok: false,
      path: filePath,
      reason: exact ? "server-exists" : "server-name-conflict",
      message: exact
        ? `${serverName} already exists in ${filePath}. Review or adopt it instead of overwriting it.`
        : `${serverName} conflicts with ${matches.join(", ")} after Pi normalizes hyphens and underscores. Resolve the duplicate before installing this preset.`,
    };
  }

  const root: McpFileRoot = {
    ...inspected.root,
    mcpServers: { ...inspected.servers, [serverName]: config },
  };
  const write = writeMcpRoot(filePath, root);
  return write.ok ? { ok: true, created: true, path: filePath } : write;
}

export function replaceMcpServer(
  filePath: string,
  serverName: string,
  config: McpServerConfig,
): McpConfigMutationResult {
  const inspected = inspectMcpConfig(filePath);
  if (inspected.ok === false) return inspectionFailure(inspected);
  if (!Object.hasOwn(inspected.servers, serverName)) {
    return {
      ok: false,
      path: filePath,
      reason: "server-missing",
      message: `${serverName} does not exist in ${filePath}.`,
    };
  }

  const root: McpFileRoot = {
    ...inspected.root,
    mcpServers: { ...inspected.servers, [serverName]: config },
  };
  const write = writeMcpRoot(filePath, root);
  return write.ok ? { ok: true, created: false, path: filePath } : write;
}

export function removeCanonicalMcpServerDuplicates(
  filePath: string,
  serverName: string,
  keepName: string,
): McpConfigMutationResult {
  const inspected = inspectMcpConfig(filePath);
  if (inspected.ok === false) return inspectionFailure(inspected);
  const matches = findCanonicalMcpServerNames(inspected.servers, serverName);
  if (!matches.includes(keepName)) {
    return {
      ok: false,
      path: filePath,
      reason: "server-missing",
      message: `${keepName} is not a canonical match for ${serverName} in ${filePath}.`,
    };
  }
  const servers = { ...inspected.servers };
  for (const name of matches) {
    if (name !== keepName) delete servers[name];
  }
  const write = writeMcpRoot(filePath, { ...inspected.root, mcpServers: servers });
  return write.ok ? { ok: true, created: false, path: filePath } : write;
}

export function setMcpServerEnabled(
  filePath: string,
  serverName: string,
  enabled: boolean,
): McpConfigMutationResult {
  const inspected = inspectMcpConfig(filePath);
  if (inspected.ok === false) return inspectionFailure(inspected);
  const current = inspected.servers[serverName];
  if (!current) {
    return {
      ok: false,
      path: filePath,
      reason: "server-missing",
      message: `${serverName} does not exist in ${filePath}.`,
    };
  }

  const root: McpFileRoot = {
    ...inspected.root,
    mcpServers: {
      ...inspected.servers,
      [serverName]: { ...current, enabled },
    },
  };
  const write = writeMcpRoot(filePath, root);
  return write.ok ? { ok: true, created: false, path: filePath } : write;
}

function writeMcpRoot(filePath: string, root: McpFileRoot): McpConfigMutationResult {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    const existingMode = existsSync(filePath) ? statSync(filePath).mode & 0o777 : 0o600;
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(tmpPath, `${JSON.stringify(root, null, 2)}\n`, {
        encoding: "utf8",
        mode: existingMode,
      });
      renameSync(tmpPath, filePath);
    } catch (error) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup only.
      }
      throw error;
    }
    return { ok: true, created: false, path: filePath };
  } catch (error) {
    return {
      ok: false,
      path: filePath,
      reason: "write-failed",
      message: `Could not update ${filePath}: ${errorMessage(error)}`,
    };
  }
}

function inspectionFailure(
  inspected: Extract<McpConfigInspection, { ok: false }>,
): McpConfigMutationResult {
  return {
    ok: false,
    path: inspected.path,
    reason: inspected.reason,
    message: inspected.message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
