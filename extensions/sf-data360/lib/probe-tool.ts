/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Read-only Data 360 readiness probe.
 *
 * Data Cloud is not a single switch from an API perspective: one surface can be
 * enabled while another is gated or empty. This probe samples a curated set of
 * read-only surfaces and returns a classification instead of relying on one
 * endpoint.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import { connRequest } from "../../../lib/common/sf-conn/request.ts";
import { buildApiPath } from "./path.ts";
import { renderCardForLlm } from "./display/card.ts";
import { probeResultToCard } from "./display/probe-card.ts";
import { renderD360ProbeCall, renderD360ProbeResult } from "./display/render.ts";
import { resolveTargetOrgContext } from "./target-org.ts";
import { buildD360Envelope, writeFullD360Output } from "./truncation.ts";

export const D360_PROBE_TOOL_NAME = "d360_probe";

export const D360ProbeParams = Type.Object({
  target_org: Type.Optional(
    Type.String({
      description:
        "Salesforce org alias or username. Defaults to the active sf-pi target org when available.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Number({ description: "Optional per-probe timeout in milliseconds. Defaults to 45000." }),
  ),
});

export interface D360ProbeInput {
  target_org?: string;
  timeout_ms?: number;
}

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
  { name: "profile_metadata", path: "/ssot/profile/metadata" },
  { name: "metadata_entities_dmo", path: "/ssot/metadata-entities?entityType=DataModelObject" },
  {
    name: "agent_platform_tracing_dlo",
    path: "/ssot/data-lake-objects/ObservabilitySpans__dll",
  },
];

export function registerD360ProbeTool(pi: ExtensionAPI): void {
  const exec = buildExecFn(pi);

  pi.registerTool({
    name: D360_PROBE_TOOL_NAME,
    label: "Data 360 Probe",
    description:
      "Run read-only probes to classify whether Data Cloud/Data 360 surfaces are available in a Salesforce org.",
    promptSnippet: "Classify Data 360 readiness with read-only REST probes",
    promptGuidelines: [
      "Use d360_probe before Data 360 workflows when org readiness is uncertain.",
      "Treat d360_probe partial results as phase-specific guidance, not as a single global on/off flag.",
      "Treat d360_probe counts as readiness/sample indicators unless countKind is total or nested_total.",
    ],
    parameters: D360ProbeParams,
    renderCall: renderD360ProbeCall,
    renderResult: renderD360ProbeResult,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as D360ProbeInput;
      const env = await resolveEnvironment(exec, ctx);
      // Resolve apiVersion against the *target* org, not the active sf-pi org.
      // Otherwise a target_org on a different release than the default produces
      // /services/data/v<wrong>/... URLs that 404 every probe and falsely
      // report "blocked".
      const { targetOrg, apiVersion } = await resolveTargetOrgContext(input.target_org, env);
      if (!targetOrg)
        throw new Error(
          "No Salesforce target org is configured. Pass target_org or set sf config target-org.",
        );

      const conn = await connFromAlias(targetOrg);
      const timeoutMs = typeof input.timeout_ms === "number" ? input.timeout_ms : 45_000;
      // Fan out all 15 probes in parallel. Each is a read-only GET; the org's
      // /ssot/* surfaces are happy with concurrent requests. Order is
      // preserved by index so the JSON output stays stable across runs.
      const probes: ProbeResult[] = await Promise.all(
        PROBES.map(async (probe) => {
          if (signal?.aborted) throw new Error("Data 360 readiness probe cancelled.");
          const apiPath = buildApiPath(probe.path, apiVersion);
          const resp = await connRequest<unknown>(conn, {
            method: "GET",
            url: apiPath,
            timeoutMs,
          });
          return classifyConnectionProbeResult(probe.name, probe.path, resp.status, resp.body);
        }),
      );

      const summary = summarizeReadiness(probes);
      const raw = { targetOrg, apiVersion, ...summary, probes };
      const text = JSON.stringify(raw, null, 2);
      const fullOutputPath = await writeFullD360Output(text);
      const card = probeResultToCard(raw, fullOutputPath);
      const compactText = renderCardForLlm(card);
      const ok =
        summary.state === "ready" || summary.state === "ready_empty" || summary.state === "partial";
      const probeDetails: Record<string, unknown> = {
        ok,
        targetOrg,
        apiVersion,
        ...summary,
        probes,
        fullOutputPath,
        card,
      };
      const sfPi = buildD360Envelope(
        D360_PROBE_TOOL_NAME,
        ok,
        compactText,
        { ...probeDetails, summary: `state=${summary.state}` },
        { text: compactText, fullOutputPath, outputMode: "summary" },
      );
      sfPi.data = { card };
      sfPi.renderHints = { profile: "balanced", collapsedLines: 48, expandedMaxLines: 120 };
      return {
        content: [{ type: "text", text: compactText }],
        details: {
          ...probeDetails,
          // Standard SF Pi tool-result envelope so renderers and downstream
          // tooling can read summary + state without per-tool branches.
          sfPi,
        },
      };
    },
  });
}

async function resolveEnvironment(
  exec: ReturnType<typeof buildExecFn>,
  ctx: ExtensionContext,
): Promise<SfEnvironment> {
  return getCachedSfEnvironment(ctx.cwd) ?? (await getSharedSfEnvironment(exec, ctx.cwd));
}

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
  const gated = probes.filter((probe) => probe.state === "feature_gated");
  const required = new Set(
    PROBES.filter((probe) => probe.requiredForReady).map((probe) => probe.name),
  );
  const requiredSuccess = probes.filter(
    (probe) =>
      required.has(probe.name) &&
      ["enabled_populated", "enabled_empty", "ok"].includes(probe.state),
  );

  if (requiredSuccess.length === required.size && gated.length === 0) {
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
