/* SPDX-License-Identifier: Apache-2.0 */
/** Non-secret ownership and drift metadata for SF MCP-managed native entries. */
import { createHash } from "node:crypto";
import { createStateStore, type StateStore } from "../../../lib/common/state-store.ts";
import {
  findCanonicalMcpServerNames,
  inspectMcpConfig,
  type McpServerConfig,
} from "./mcp-config.ts";
import type { McpPresetId, McpResolution } from "./presets.ts";

export interface ManagedServerRecord {
  presetId: McpPresetId;
  presetRevision: number;
  resolution: McpResolution;
  configFingerprint: string;
}

interface ManagedState {
  servers: Record<string, ManagedServerRecord>;
}

export type ManagedServerStatus =
  | "missing"
  | "manual"
  | "managed-enabled"
  | "managed-disabled"
  | "managed-outdated"
  | "modified"
  | "name-conflict"
  | "invalid-config";

export interface ManagedServerInspection {
  status: ManagedServerStatus;
  configuredName?: string;
  conflictingNames?: string[];
  config?: McpServerConfig;
  record?: ManagedServerRecord;
  message?: string;
}

const DEFAULT_STATE: ManagedState = { servers: {} };

export function createManagedStateStore(
  cwd: string,
  scope: "global" | "project",
  pathOverride?: string,
): StateStore<ManagedState> {
  return createStateStore<ManagedState>({
    namespace: "sf-mcp",
    filename: "managed-presets.json",
    schemaVersion: 2,
    defaults: DEFAULT_STATE,
    scope,
    cwd,
    mode: 0o600,
    ...(pathOverride ? { pathOverride } : {}),
    migrate: (raw) => normalizeState(raw),
  });
}

export function recordManagedServer(
  store: StateStore<ManagedState>,
  serverName: string,
  input: {
    presetId: McpPresetId;
    presetRevision: number;
    resolution: McpResolution;
    config: McpServerConfig;
  },
): void {
  store.update((current) => {
    const normalized = normalizeState(current);
    return {
      servers: {
        ...normalized.servers,
        [serverName]: {
          presetId: input.presetId,
          presetRevision: input.presetRevision,
          resolution: input.resolution,
          configFingerprint: fingerprintConfig(input.config),
        },
      },
    };
  });
}

export function forgetManagedServer(store: StateStore<ManagedState>, serverName: string): void {
  store.update((current) => {
    const normalized = normalizeState(current);
    const servers = { ...normalized.servers };
    delete servers[serverName];
    return { servers };
  });
}

export function inspectManagedServer(
  mcpFile: string,
  store: StateStore<ManagedState>,
  input: { serverName: string; presetId: McpPresetId; presetRevision: number },
): ManagedServerInspection {
  const inspected = inspectMcpConfig(mcpFile);
  if (inspected.ok === false) {
    return { status: "invalid-config", message: inspected.message };
  }
  const matches = findCanonicalMcpServerNames(inspected.servers, input.serverName);
  if (matches.length === 0) return { status: "missing" };
  if (matches.length > 1) {
    return {
      status: "name-conflict",
      conflictingNames: matches,
      message: `${matches.join(", ")} collide after Pi normalizes hyphens and underscores.`,
    };
  }

  const configuredName = matches[0];
  if (!configuredName) return { status: "missing" };
  const config = inspected.servers[configuredName];
  if (!config) return { status: "missing" };
  const record = normalizeState(store.read()).servers[configuredName];
  if (!record || record.presetId !== input.presetId) {
    return { status: "manual", configuredName, config };
  }
  if (record.configFingerprint !== fingerprintConfig(config)) {
    return {
      status: "modified",
      configuredName,
      config,
      record,
      message: "The native MCP entry changed after SF MCP created it. Review before replacing it.",
    };
  }
  if (record.presetRevision < input.presetRevision) {
    return {
      status: "managed-outdated",
      configuredName,
      config,
      record,
      message: `Preset revision ${record.presetRevision} is older than revision ${input.presetRevision}. Review the current preset before updating.`,
    };
  }
  return {
    status: config.enabled === false ? "managed-disabled" : "managed-enabled",
    configuredName,
    config,
    record,
  };
}

export function fingerprintConfig(config: McpServerConfig): string {
  return createHash("sha256").update(stableJson(config)).digest("hex").slice(0, 16);
}

function normalizeState(value: unknown): ManagedState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_STATE;
  const servers = (value as { servers?: unknown }).servers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return DEFAULT_STATE;

  const normalized: Record<string, ManagedServerRecord> = {};
  for (const [name, raw] of Object.entries(servers)) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Partial<ManagedServerRecord>;
    if (
      typeof item.presetId !== "string" ||
      typeof item.resolution !== "string" ||
      typeof item.configFingerprint !== "string"
    ) {
      continue;
    }
    normalized[name] = {
      presetId: item.presetId as McpPresetId,
      presetRevision:
        typeof item.presetRevision === "number" && Number.isInteger(item.presetRevision)
          ? item.presetRevision
          : 0,
      resolution: item.resolution as McpResolution,
      configFingerprint: item.configFingerprint,
    };
  }
  return { servers: normalized };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
