/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only Data 360 readiness contracts and classifiers. */

export type ProbeState =
  | "enabled_populated"
  | "enabled_empty"
  | "ok"
  | "feature_gated"
  | "not_found"
  | "tenant_missing"
  | "cli_error"
  | "unknown_error";

export type ProbeCountKind = "total" | "returned_rows" | "nested_total";

export interface ProbeResult {
  name: string;
  path: string;
  url?: string;
  state: ProbeState;
  count?: number;
  countKind?: ProbeCountKind;
  keys?: string[];
  message?: string;
  featureCode?: string;
  exitCode?: number | null;
}

export const PROBES: Array<{ name: string; path: string; requiredForReady?: boolean }> = [
  { name: "data_spaces", path: "/ssot/data-spaces", requiredForReady: true },
  { name: "dmo_catalog", path: "/ssot/data-model-objects?limit=1", requiredForReady: true },
  { name: "dlo_catalog", path: "/ssot/data-lake-objects?limit=1" },
  { name: "data_streams", path: "/ssot/data-streams?limit=1" },
  { name: "calculated_insights", path: "/ssot/calculated-insights?limit=1" },
  { name: "connectors", path: "/ssot/connectors" },
  { name: "connections_sfdc", path: "/ssot/connections?connectorType=SalesforceDotCom" },
  { name: "segments", path: "/ssot/segments?limit=1" },
  { name: "identity_resolution", path: "/ssot/identity-resolutions?limit=1" },
  { name: "activations", path: "/ssot/activations?limit=1" },
  { name: "data_transforms", path: "/ssot/data-transforms?limit=1" },
  { name: "data_actions", path: "/ssot/data-actions?limit=1" },
  { name: "semantic_models", path: "/ssot/semantic/models?limit=1" },
  { name: "data_kits", path: "/ssot/data-kits?limit=1" },
  { name: "personalization_org", path: "/personalization/external-apps/org" },
  { name: "profile_metadata", path: "/ssot/profile/metadata" },
  { name: "metadata_entities_dmo", path: "/ssot/metadata-entities?entityType=DataModelObject" },
  { name: "agent_platform_tracing_dlo", path: "/ssot/data-lake-objects/ObservabilitySpans__dll" },
];

/**
 * Classify a probe result using the parsed body returned by
 * `Connection.request` plus the HTTP status. Replaces the prior CLI-output
 * shape (exitCode + stdout + stderr).
 */
export function classifyConnectionProbeResult(
  name: string,
  path: string,
  status: number,
  body: unknown,
): ProbeResult {
  const message = extractMessage(body);
  const featureCode = message?.match(/\[([A-Za-z0-9]+)\]/)?.[1];
  const exitCode = status >= 200 && status < 300 ? 0 : 1;

  if (message?.includes("This feature is not currently enabled")) {
    return { name, path, state: "feature_gated", message, featureCode, exitCode };
  }
  if (message?.includes("Couldn't find CDP tenant ID")) {
    return { name, path, state: "tenant_missing", message, exitCode };
  }
  if (status < 200 || status >= 300) {
    const state =
      status === 404 || message?.includes("requested resource does not exist")
        ? "not_found"
        : "cli_error";
    return { name, path, state, message, exitCode };
  }
  if (!body || typeof body !== "object") {
    return { name, path, state: "ok", exitCode };
  }

  const keys = Object.keys(body as Record<string, unknown>);
  const countInfo = inferCount(body);
  if (countInfo) {
    return {
      name,
      path,
      state: countInfo.count > 0 ? "enabled_populated" : "enabled_empty",
      count: countInfo.count,
      countKind: countInfo.kind,
      keys,
      exitCode,
    };
  }
  return { name, path, state: "ok", keys, exitCode };
}

export function summarizeReadiness(probes: ProbeResult[]): {
  state: "ready" | "ready_empty" | "partial" | "blocked";
  guidance: string;
} {
  const successes = probes.filter((probe) =>
    ["enabled_populated", "enabled_empty", "ok"].includes(probe.state),
  );
  const populated = successes.some((probe) => probe.state === "enabled_populated");
  const unavailable = probes.filter(
    (probe) => !["enabled_populated", "enabled_empty", "ok"].includes(probe.state),
  );
  const required = new Set(
    PROBES.filter((probe) => probe.requiredForReady).map((probe) => probe.name),
  );
  const requiredSuccess = probes.filter(
    (probe) =>
      required.has(probe.name) &&
      ["enabled_populated", "enabled_empty", "ok"].includes(probe.state),
  );

  if (requiredSuccess.length === required.size && unavailable.length === 0) {
    return {
      state: populated ? "ready" : "ready_empty",
      guidance: populated
        ? "Core Data 360 surfaces are reachable and at least one probed surface has data."
        : "Core Data 360 surfaces are reachable but the sampled surfaces appear empty.",
    };
  }
  if (successes.length > 0) {
    return {
      state: "partial",
      guidance:
        "Some Data 360 surfaces are reachable, but one or more phase-specific surfaces are gated or unavailable. Continue only with the reachable phase and review gated feature codes.",
    };
  }
  return {
    state: "blocked",
    guidance:
      "No sampled Data 360 surfaces were reachable. Review Data Cloud provisioning, user permissions, and org readiness before running Data 360 workflows.",
  };
}

function extractMessage(parsed: unknown): string | undefined {
  if (Array.isArray(parsed)) {
    const first = parsed[0] as { message?: unknown } | undefined;
    return typeof first?.message === "string" ? first.message : undefined;
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as { message?: unknown; error?: { message?: unknown } };
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error?.message === "string") return obj.error.message;
  }
  return undefined;
}

function inferCount(parsed: unknown): { count: number; kind: ProbeCountKind } | undefined {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.totalSize === "number") return { count: obj.totalSize, kind: "total" };
  if (typeof obj.total === "number") return { count: obj.total, kind: "total" };
  if (typeof obj.count === "number") return { count: obj.count, kind: "total" };
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) return { count: value.length, kind: "returned_rows" };
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      if (typeof nested.total === "number") return { count: nested.total, kind: "nested_total" };
      if (typeof nested.count === "number") return { count: nested.count, kind: "nested_total" };
      if (Array.isArray(nested.items)) return { count: nested.items.length, kind: "returned_rows" };
    }
  }
  return undefined;
}
